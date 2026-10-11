// Copy into your app (e.g. lib/f2f_tag.dart). Tags a widget with its Figma node id so `f2f verify` can measure it on web (Chrome), Android (adb), iOS (idb) or in `flutter test`.
import 'package:flutter/widgets.dart';

Widget figma(String? id, Widget child) => id == null ? child : Semantics(identifier: 'figma:$id', container: true, child: child);
