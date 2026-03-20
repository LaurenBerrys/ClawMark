import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('desktop console test harness stays valid', (WidgetTester tester) async {
    await tester.pumpWidget(
      const Directionality(
        textDirection: TextDirection.ltr,
        child: Material(
          child: Text('ClawMark Desktop Console'),
        ),
      ),
    );

    expect(find.text('ClawMark Desktop Console'), findsOneWidget);
  });
}
