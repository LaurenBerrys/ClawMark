import 'package:flutter/material.dart';

class DesktopTokens {
  static const background = Color(0xFF131314);
  static const sidebar = Color(0xFF121214);
  static const surface = Color(0xFF201F20);
  static const surfaceMuted = Color(0xFF1C1B1C);
  static const surfaceElevated = Color(0xFF262527);
  static const border = Color(0x26414754);
  static const borderStrong = Color(0x4CAEC6FF);
  static const accent = Color(0xFFAEC6FF);
  static const accentStrong = Color(0xFF4E8EFF);
  static const accentDeep = Color(0xFF00275D);
  static const accentSurface = Color(0xFF182033);
  static const accentSurfaceStrong = Color(0xFF1B2B4D);
  static const textPrimary = Color(0xFFE5E2E3);
  static const textSecondary = Color(0x99C1C6D7);
  static const textMuted = Color(0x66C1C6D7);
  static const success = Color(0xFF9BE3B0);
  static const warning = Color(0xFFF2C57C);
  static const danger = Color(0xFFE08383);
  static const successSurface = Color(0xFF17231C);
  static const successBorder = Color(0x409BE3B0);
  static const warningSurface = Color(0xFF2A2217);
  static const warningBorder = Color(0x40F2C57C);
  static const dangerSurface = Color(0xFF2C1B1C);
  static const dangerBorder = Color(0x40E08383);
  static const shadow = Color(0x66000000);

  static const headingFont = "NotoSansSC";
  static const bodyFont = "Inter";
  static const monoFont = "SpaceGrotesk";
}

ThemeData buildDesktopTheme() {
  final base = ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    fontFamily: DesktopTokens.bodyFont,
    scaffoldBackgroundColor: DesktopTokens.background,
    colorScheme: const ColorScheme.dark(
      primary: DesktopTokens.accent,
      secondary: DesktopTokens.accentStrong,
      surface: DesktopTokens.surface,
      error: DesktopTokens.danger,
      onPrimary: DesktopTokens.accentDeep,
      onSecondary: DesktopTokens.accentDeep,
      onSurface: DesktopTokens.textPrimary,
      onError: DesktopTokens.background,
    ),
  );
  final textTheme = base.textTheme.copyWith(
    headlineLarge: const TextStyle(
      fontFamily: DesktopTokens.headingFont,
      fontFamilyFallback: <String>[
        "PingFang SC",
        "Microsoft YaHei",
        "sans-serif",
      ],
      fontSize: 40,
      height: 1.1,
      fontWeight: FontWeight.w600,
      color: DesktopTokens.textPrimary,
      letterSpacing: -1.0,
    ),
    headlineMedium: const TextStyle(
      fontFamily: DesktopTokens.headingFont,
      fontFamilyFallback: <String>[
        "PingFang SC",
        "Microsoft YaHei",
        "sans-serif",
      ],
      fontSize: 30,
      height: 1.15,
      fontWeight: FontWeight.w600,
      color: DesktopTokens.textPrimary,
      letterSpacing: -0.6,
    ),
    titleLarge: const TextStyle(
      fontFamily: DesktopTokens.headingFont,
      fontFamilyFallback: <String>[
        "PingFang SC",
        "Microsoft YaHei",
        "sans-serif",
      ],
      fontSize: 20,
      height: 1.2,
      fontWeight: FontWeight.w600,
      color: DesktopTokens.textPrimary,
    ),
    titleMedium: const TextStyle(
      fontFamily: DesktopTokens.headingFont,
      fontFamilyFallback: <String>[
        "PingFang SC",
        "Microsoft YaHei",
        "sans-serif",
      ],
      fontSize: 15,
      height: 1.25,
      fontWeight: FontWeight.w600,
      color: DesktopTokens.textPrimary,
    ),
    bodyLarge: const TextStyle(
      fontFamily: DesktopTokens.bodyFont,
      fontFamilyFallback: <String>[
        "Noto Sans SC",
        "PingFang SC",
        "Microsoft YaHei",
        "sans-serif",
      ],
      fontSize: 15,
      height: 1.45,
      color: DesktopTokens.textPrimary,
    ),
    bodyMedium: const TextStyle(
      fontFamily: DesktopTokens.bodyFont,
      fontFamilyFallback: <String>[
        "Noto Sans SC",
        "PingFang SC",
        "Microsoft YaHei",
        "sans-serif",
      ],
      fontSize: 13,
      height: 1.5,
      color: DesktopTokens.textSecondary,
    ),
    labelLarge: const TextStyle(
      fontFamily: DesktopTokens.monoFont,
      fontFamilyFallback: <String>["Inter", "sans-serif"],
      fontSize: 11,
      height: 1.35,
      color: DesktopTokens.textMuted,
      letterSpacing: 1.0,
      fontWeight: FontWeight.w500,
    ),
  );
  final outline = OutlineInputBorder(
    borderRadius: BorderRadius.circular(12),
    borderSide: const BorderSide(color: DesktopTokens.border),
  );
  return base.copyWith(
    textTheme: textTheme,
    dividerColor: DesktopTokens.border,
    splashFactory: NoSplash.splashFactory,
    cardTheme: CardThemeData(
      color: DesktopTokens.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: const BorderSide(color: DesktopTokens.border),
      ),
    ),
    iconTheme: const IconThemeData(color: DesktopTokens.textSecondary),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: DesktopTokens.surfaceMuted,
      hintStyle: textTheme.bodyMedium?.copyWith(color: DesktopTokens.textMuted),
      labelStyle: textTheme.bodyMedium,
      enabledBorder: outline,
      focusedBorder: outline.copyWith(
        borderSide: const BorderSide(color: DesktopTokens.accent, width: 1.2),
      ),
      border: outline,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: DesktopTokens.accentStrong,
        foregroundColor: DesktopTokens.accentDeep,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: textTheme.titleMedium,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: DesktopTokens.accent,
        side: const BorderSide(color: DesktopTokens.borderStrong),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        textStyle: textTheme.titleMedium,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: DesktopTokens.textSecondary,
        textStyle: textTheme.titleMedium,
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: DesktopTokens.surfaceElevated,
      labelStyle: textTheme.bodyMedium,
      side: const BorderSide(color: DesktopTokens.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: DesktopTokens.accent,
      linearTrackColor: DesktopTokens.surfaceElevated,
      circularTrackColor: DesktopTokens.surfaceElevated,
    ),
  );
}

enum DesktopSurfaceTone { base, muted, accent, success, warning, danger }

class DesktopSurfaceCard extends StatelessWidget {
  const DesktopSurfaceCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.tone = DesktopSurfaceTone.base,
    this.radius = 18,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final DesktopSurfaceTone tone;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final decoration = _surfaceDecoration(tone, radius);
    return Container(
      decoration: decoration,
      child: Padding(padding: padding, child: child),
    );
  }
}

class DesktopSectionHeader extends StatelessWidget {
  const DesktopSectionHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.trailing,
  });

  final String title;
  final String subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 6),
              Text(subtitle, style: Theme.of(context).textTheme.bodyMedium),
            ],
          ),
        ),
        if (trailing != null) ...[const SizedBox(width: 16), trailing!],
      ],
    );
  }
}

class DesktopStatusPill extends StatelessWidget {
  const DesktopStatusPill({super.key, required this.label, required this.tone});

  final String label;
  final DesktopSurfaceTone tone;

  @override
  Widget build(BuildContext context) {
    final palette = _tonePalette(tone);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: palette.$1,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: palette.$3),
      ),
      child: Text(
        label,
        style: Theme.of(
          context,
        ).textTheme.labelLarge?.copyWith(color: palette.$2),
      ),
    );
  }
}

class DesktopMetricChip extends StatelessWidget {
  const DesktopMetricChip({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: _surfaceDecoration(DesktopSurfaceTone.muted, 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: DesktopTokens.accent),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.labelLarge),
              const SizedBox(height: 4),
              Text(
                value,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontFamily: DesktopTokens.bodyFont,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class DesktopFactTile extends StatelessWidget {
  const DesktopFactTile({
    super.key,
    required this.label,
    required this.value,
    this.tone = DesktopSurfaceTone.muted,
  });

  final String label;
  final String value;
  final DesktopSurfaceTone tone;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 220,
      padding: const EdgeInsets.all(14),
      decoration: _surfaceDecoration(tone, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 6),
          Text(
            value.isEmpty ? "—" : value,
            style: Theme.of(context).textTheme.titleMedium,
          ),
        ],
      ),
    );
  }
}

BoxDecoration _surfaceDecoration(DesktopSurfaceTone tone, double radius) {
  final colors = switch (tone) {
    DesktopSurfaceTone.base => (DesktopTokens.surface, DesktopTokens.border),
    DesktopSurfaceTone.muted => (
      DesktopTokens.surfaceMuted,
      DesktopTokens.border,
    ),
    DesktopSurfaceTone.accent => (
      DesktopTokens.accentSurface,
      DesktopTokens.borderStrong,
    ),
    DesktopSurfaceTone.success => (
      DesktopTokens.successSurface,
      DesktopTokens.successBorder,
    ),
    DesktopSurfaceTone.warning => (
      DesktopTokens.warningSurface,
      DesktopTokens.warningBorder,
    ),
    DesktopSurfaceTone.danger => (
      DesktopTokens.dangerSurface,
      DesktopTokens.dangerBorder,
    ),
  };
  return BoxDecoration(
    color: colors.$1,
    borderRadius: BorderRadius.circular(radius),
    border: Border.all(color: colors.$2),
    boxShadow: const [
      BoxShadow(
        color: DesktopTokens.shadow,
        blurRadius: 30,
        offset: Offset(0, 16),
      ),
    ],
  );
}

(Color, Color, Color) _tonePalette(DesktopSurfaceTone tone) {
  return switch (tone) {
    DesktopSurfaceTone.accent => (
      DesktopTokens.accentSurfaceStrong,
      DesktopTokens.accent,
      DesktopTokens.borderStrong,
    ),
    DesktopSurfaceTone.success => (
      DesktopTokens.successSurface,
      DesktopTokens.success,
      DesktopTokens.successBorder,
    ),
    DesktopSurfaceTone.warning => (
      DesktopTokens.warningSurface,
      DesktopTokens.warning,
      DesktopTokens.warningBorder,
    ),
    DesktopSurfaceTone.danger => (
      DesktopTokens.dangerSurface,
      DesktopTokens.danger,
      DesktopTokens.dangerBorder,
    ),
    _ => (
      DesktopTokens.surfaceElevated,
      DesktopTokens.textSecondary,
      DesktopTokens.border,
    ),
  };
}
