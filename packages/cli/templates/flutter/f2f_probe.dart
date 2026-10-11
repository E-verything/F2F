// Copy into your app's test/ folder. Measures every widget tagged with figma(...) without a device and writes JSON for `f2f verify --measurements`.
// Bundle the app's fonts as assets (not runtime-fetched) or text sizes will use the test font.
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

Future<File> probeScreen(WidgetTester tester, {required String screenId, required Widget screen, required Size viewport, String outDir = 'build/f2f'}) async {
  tester.view.physicalSize = viewport;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final errors = <String>[];
  final previous = FlutterError.onError;
  FlutterError.onError = (d) => errors.add(d.exceptionAsString().split('\n').first);
  await tester.pumpWidget(MaterialApp(debugShowCheckedModeBanner: false, home: Align(alignment: Alignment.topLeft, child: screen)));
  await tester.pumpAndSettle();
  FlutterError.onError = previous;

  final nodes = <String, Map<String, Object>>{};
  final tagged = find.byWidgetPredicate((w) => w is Semantics && (w.properties.identifier?.startsWith('figma:') ?? false));
  for (final e in tagged.evaluate()) {
    final id = (e.widget as Semantics).properties.identifier!.substring(6);
    final box = e.renderObject as RenderBox;
    final o = box.localToGlobal(Offset.zero);
    final m = <String, Object>{'x': o.dx, 'y': o.dy, 'width': box.size.width, 'height': box.size.height};
    void visit(RenderObject r) {
      if (r is RenderParagraph && r.didExceedMaxLines) m['overflow'] = true;
      r.visitChildren(visit);
    }
    visit(box);
    nodes.putIfAbsent(id, () => m);
  }
  final out = File('$outDir/${screenId.replaceAll(RegExp(r'[^A-Za-z0-9]+'), '-')}.json')..createSync(recursive: true);
  out.writeAsStringSync(jsonEncode({
    'screenId': screenId,
    'source': 'flutter test probe${errors.isEmpty ? '' : ' (layout errors: ${errors.toSet().join('; ')})'}',
    'viewport': {'width': viewport.width, 'height': viewport.height},
    'nodes': nodes,
  }));
  return out;
}
