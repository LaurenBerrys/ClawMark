#include "desktop_runtime_host.h"

#include <filesystem>
#include <string>
#include <vector>

namespace {

constexpr wchar_t kDisableAutostartEnv[] =
    L"CLAWMARK_DESKTOP_DISABLE_LOCAL_RUNTIME_AUTOSTART";
constexpr wchar_t kRuntimeHostMarkerEnv[] = L"CLAWMARK_DESKTOP_RUNTIME_HOST";
constexpr wchar_t kPathEnv[] = L"PATH";
constexpr wchar_t kLogFileName[] = L"desktop-runtime-host.log";
constexpr int kGatewayPort = 18789;

std::wstring QuoteForCommandLine(const std::wstring& value) {
  std::wstring quoted = L"\"";
  for (const wchar_t ch : value) {
    if (ch == L'"') {
      quoted += L"\\\"";
    } else {
      quoted.push_back(ch);
    }
  }
  quoted += L"\"";
  return quoted;
}

}  // namespace

DesktopRuntimeHost::DesktopRuntimeHost() = default;

DesktopRuntimeHost::~DesktopRuntimeHost() {
  this->StopIfOwned();
}

void DesktopRuntimeHost::StartIfAvailable() {
  if (this->owns_process_) {
    return;
  }
  if (this->ReadEnvironmentVariable(kDisableAutostartEnv) == L"1") {
    this->DebugLog(L"bundled runtime autostart disabled by environment");
    return;
  }

  const std::filesystem::path runtime_root(this->ResolveRuntimeRoot());
  if (runtime_root.empty() || !std::filesystem::exists(runtime_root)) {
    this->DebugLog(L"bundled runtime payload not found; skipping autostart");
    return;
  }

  const auto node_path = runtime_root / L"bin" / L"node.exe";
  const auto entrypoint_path = runtime_root / L"app" / L"openclaw.mjs";
  const auto app_root = runtime_root / L"app";
  if (!std::filesystem::exists(node_path) || !std::filesystem::exists(entrypoint_path)) {
    this->DebugLog(L"bundled runtime payload is incomplete; node.exe or openclaw.mjs missing");
    return;
  }

  const std::wstring previous_path = this->ReadEnvironmentVariable(kPathEnv);
  const std::wstring bin_root = (runtime_root / L"bin").wstring();
  const std::wstring merged_path =
      previous_path.empty() ? bin_root : bin_root + L";" + previous_path;
  ::SetEnvironmentVariableW(kPathEnv, merged_path.c_str());
  ::SetEnvironmentVariableW(kRuntimeHostMarkerEnv, L"1");

  this->log_handle_ = this->OpenLogHandle();

  STARTUPINFOW startup_info{};
  startup_info.cb = sizeof(startup_info);
  if (this->log_handle_ != INVALID_HANDLE_VALUE) {
    startup_info.dwFlags |= STARTF_USESTDHANDLES;
    startup_info.hStdOutput = this->log_handle_;
    startup_info.hStdError = this->log_handle_;
    startup_info.hStdInput = ::GetStdHandle(STD_INPUT_HANDLE);
  }

  std::wstring command_line =
      QuoteForCommandLine(node_path.wstring()) + L" " +
      QuoteForCommandLine(entrypoint_path.wstring()) +
      L" gateway run --port " + std::to_wstring(kGatewayPort) +
      L" --bind loopback --auth none --allow-unconfigured";

  const BOOL created = ::CreateProcessW(
      node_path.c_str(),
      command_line.data(),
      nullptr,
      nullptr,
      this->log_handle_ != INVALID_HANDLE_VALUE,
      CREATE_NO_WINDOW,
      nullptr,
      app_root.c_str(),
      &startup_info,
      &this->process_info_);

  if (previous_path.empty()) {
    ::SetEnvironmentVariableW(kPathEnv, nullptr);
  } else {
    ::SetEnvironmentVariableW(kPathEnv, previous_path.c_str());
  }
  ::SetEnvironmentVariableW(kRuntimeHostMarkerEnv, nullptr);

  if (!created) {
    this->DebugLog(L"failed to start bundled runtime host");
    this->CloseProcessHandles();
    this->CloseLogHandle();
    return;
  }

  this->owns_process_ = true;
  this->DebugLog(L"started bundled runtime host");
}

void DesktopRuntimeHost::StopIfOwned() {
  if (!this->owns_process_) {
    this->CloseProcessHandles();
    this->CloseLogHandle();
    return;
  }

  if (this->process_info_.hProcess != nullptr) {
    DWORD exit_code = 0;
    if (::GetExitCodeProcess(this->process_info_.hProcess, &exit_code) &&
        exit_code == STILL_ACTIVE) {
      ::TerminateProcess(this->process_info_.hProcess, 0);
      ::WaitForSingleObject(this->process_info_.hProcess, 2000);
    }
  }

  this->owns_process_ = false;
  this->CloseProcessHandles();
  this->CloseLogHandle();
  this->DebugLog(L"stopped bundled runtime host");
}

std::wstring DesktopRuntimeHost::ResolveRuntimeRoot() const {
  const std::filesystem::path exe_directory(this->ResolveExecutableDirectory());
  if (exe_directory.empty()) {
    return std::wstring();
  }
  return (exe_directory / L"data" / L"DesktopRuntime").wstring();
}

std::wstring DesktopRuntimeHost::ResolveExecutableDirectory() const {
  std::vector<wchar_t> buffer(MAX_PATH, L'\0');
  DWORD length = ::GetModuleFileNameW(nullptr, buffer.data(),
                                      static_cast<DWORD>(buffer.size()));
  while (length == buffer.size()) {
    buffer.resize(buffer.size() * 2, L'\0');
    length = ::GetModuleFileNameW(nullptr, buffer.data(),
                                  static_cast<DWORD>(buffer.size()));
  }
  if (length == 0) {
    return std::wstring();
  }
  return std::filesystem::path(std::wstring(buffer.data(), length))
      .parent_path()
      .wstring();
}

std::wstring DesktopRuntimeHost::ResolveLogPath() const {
  const std::wstring local_app_data = this->ReadEnvironmentVariable(L"LOCALAPPDATA");
  if (local_app_data.empty()) {
    return std::wstring();
  }
  const auto log_dir = std::filesystem::path(local_app_data) / L"ClawMark" /
                       L"DesktopConsole" / L"logs";
  std::error_code ec;
  std::filesystem::create_directories(log_dir, ec);
  return (log_dir / kLogFileName).wstring();
}

std::wstring DesktopRuntimeHost::ReadEnvironmentVariable(
    const wchar_t* name) const {
  const DWORD required = ::GetEnvironmentVariableW(name, nullptr, 0);
  if (required == 0) {
    return std::wstring();
  }
  std::wstring value(required, L'\0');
  const DWORD written = ::GetEnvironmentVariableW(name, value.data(), required);
  if (written == 0) {
    return std::wstring();
  }
  value.resize(written);
  return value;
}

HANDLE DesktopRuntimeHost::OpenLogHandle() {
  const std::wstring log_path = this->ResolveLogPath();
  if (log_path.empty()) {
    return INVALID_HANDLE_VALUE;
  }
  SECURITY_ATTRIBUTES attributes{};
  attributes.nLength = sizeof(attributes);
  attributes.bInheritHandle = TRUE;
  attributes.lpSecurityDescriptor = nullptr;
  return ::CreateFileW(
      log_path.c_str(),
      FILE_APPEND_DATA,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      &attributes,
      OPEN_ALWAYS,
      FILE_ATTRIBUTE_NORMAL,
      nullptr);
}

void DesktopRuntimeHost::CloseProcessHandles() {
  if (this->process_info_.hThread != nullptr) {
    ::CloseHandle(this->process_info_.hThread);
    this->process_info_.hThread = nullptr;
  }
  if (this->process_info_.hProcess != nullptr) {
    ::CloseHandle(this->process_info_.hProcess);
    this->process_info_.hProcess = nullptr;
  }
  this->process_info_.dwProcessId = 0;
  this->process_info_.dwThreadId = 0;
}

void DesktopRuntimeHost::CloseLogHandle() {
  if (this->log_handle_ != INVALID_HANDLE_VALUE) {
    ::CloseHandle(this->log_handle_);
    this->log_handle_ = INVALID_HANDLE_VALUE;
  }
}

void DesktopRuntimeHost::DebugLog(const std::wstring& message) const {
  ::OutputDebugStringW((L"[ClawMarkDesktopRuntimeHost] " + message + L"\n").c_str());
}
