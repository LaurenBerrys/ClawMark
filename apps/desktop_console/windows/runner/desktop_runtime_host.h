#ifndef RUNNER_DESKTOP_RUNTIME_HOST_H_
#define RUNNER_DESKTOP_RUNTIME_HOST_H_

#include <windows.h>

#include <string>

class DesktopRuntimeHost {
 public:
  DesktopRuntimeHost();
  ~DesktopRuntimeHost();

  void StartIfAvailable();
  void StopIfOwned();

 private:
  std::wstring ResolveRuntimeRoot() const;
  std::wstring ResolveExecutableDirectory() const;
  std::wstring ResolveLogPath() const;
  std::wstring ReadEnvironmentVariable(const wchar_t* name) const;
  HANDLE OpenLogHandle();
  void CloseProcessHandles();
  void CloseLogHandle();
  void DebugLog(const std::wstring& message) const;

  PROCESS_INFORMATION process_info_{};
  HANDLE log_handle_ = INVALID_HANDLE_VALUE;
  bool owns_process_ = false;
};

#endif  // RUNNER_DESKTOP_RUNTIME_HOST_H_
