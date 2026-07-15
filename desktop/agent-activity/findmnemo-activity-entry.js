(function () {
  try {
    var options = argumentsFrom(WScript.Arguments);
    if (options.Owner !== 'findmnemo-agent-activity-v1') quit();
    if (options.Agent !== 'codex-cli' && options.Agent !== 'claude-code' && options.Agent !== 'pi') quit();
    var input = decodeUtf8Transport(WScript.StdIn.ReadAll());
    if (utf8Length(input, 2097153) > 2097152) quit();
    var keys = options.Agent === 'pi'
      ? ['event_name', 'session_id', 'model', 'generation', 'explicit']
      : ['hook_event_name', 'session_id', 'model', 'generation', 'task_id', 'task_subject', 'notification_type'];
    var safe = parseTopLevelObject(input, allowlist(keys));
    var encoded = base64(utf8Bytes(stringifySafe(safe, keys)));
    if (options.ValidationOnly === 'findmnemo-sanitizer-test-v1') {
      WScript.Echo(encoded);
      quit();
    }
    var fso = new ActiveXObject('Scripting.FileSystemObject');
    var directory = fso.GetParentFolderName(WScript.ScriptFullName);
    var expectedExecutable = fso.GetAbsolutePathName(fso.BuildPath(fso.GetParentFolderName(fso.GetParentFolderName(directory)), 'FindMnemo Companion.exe'));
    if (fso.GetAbsolutePathName(options.Executable || '').toLowerCase() !== expectedExecutable.toLowerCase()) quit();
    var launcher = fso.BuildPath(directory, 'findmnemo-activity-launch.cmd');
    var command = 'cmd.exe /d /c call ' + quoteCommandArgument(launcher) + ' ' + options.Agent + ' ' + encoded + ' <NUL >NUL 2>&1';
    new ActiveXObject('WScript.Shell').Run(command, 0, false);
  } catch (ignored) {
    if (!ignored) quit();
    // Monitoring must never fail or delay the originating agent action.
  }
  quit();
}());

function argumentsFrom(values) {
  var result = {};
  for (var i = 0; i < values.length; i += 1) {
    var name = String(values.Item(i));
    if (name.charAt(0) !== '-' || i + 1 >= values.length) continue;
    result[name.replace(/^-+/, '')] = String(values.Item(++i));
  }
  return result;
}

function allowlist(keys) {
  var result = {};
  for (var i = 0; i < keys.length; i += 1) result[keys[i]] = true;
  return result;
}

function parseTopLevelObject(text, allowed) {
  var parser = { text: text, at: 0 };
  var result = {};
  whitespace(parser);
  expect(parser, '{');
  whitespace(parser);
  if (peek(parser) === '}') { parser.at += 1; finish(parser); return result; }
  while (true) {
    var key = stringValue(parser);
    whitespace(parser); expect(parser, ':'); whitespace(parser);
    if (allowed[key]) {
      var selected = primitiveValue(parser, 1);
      if (selected.accepted) result[key] = selected.value;
    } else skipValue(parser, 1);
    whitespace(parser);
    var separator = peek(parser);
    if (separator === '}') { parser.at += 1; finish(parser); return result; }
    expect(parser, ','); whitespace(parser);
  }
}

function primitiveValue(parser, depth) {
  var leading = peek(parser);
  if (leading === '"') return { accepted: true, value: stringValue(parser) };
  if (leading === 't') { literal(parser, 'true'); return { accepted: true, value: true }; }
  if (leading === 'f') { literal(parser, 'false'); return { accepted: true, value: false }; }
  if (leading === 'n') { literal(parser, 'null'); return { accepted: true, value: null }; }
  if (leading === '{' || leading === '[') { skipValue(parser, depth); return { accepted: false }; }
  return { accepted: true, value: numberValue(parser) };
}

function skipValue(parser, depth) {
  if (depth > 6) fail();
  whitespace(parser);
  var leading = peek(parser);
  if (leading === '"') { stringValue(parser); return; }
  if (leading === 't') { literal(parser, 'true'); return; }
  if (leading === 'f') { literal(parser, 'false'); return; }
  if (leading === 'n') { literal(parser, 'null'); return; }
  if (leading === '{') {
    parser.at += 1; whitespace(parser);
    if (peek(parser) === '}') { parser.at += 1; return; }
    while (true) {
      stringValue(parser); whitespace(parser); expect(parser, ':'); skipValue(parser, depth + 1); whitespace(parser);
      if (peek(parser) === '}') { parser.at += 1; return; }
      expect(parser, ','); whitespace(parser);
    }
  }
  if (leading === '[') {
    parser.at += 1; whitespace(parser);
    if (peek(parser) === ']') { parser.at += 1; return; }
    while (true) {
      skipValue(parser, depth + 1); whitespace(parser);
      if (peek(parser) === ']') { parser.at += 1; return; }
      expect(parser, ','); whitespace(parser);
    }
  }
  numberValue(parser);
}

function stringValue(parser) {
  expect(parser, '"');
  var result = '';
  while (parser.at < parser.text.length) {
    var value = parser.text.charAt(parser.at++);
    if (value === '"') return result;
    if (value === '\\') {
      var escaped = parser.text.charAt(parser.at++);
      if (escaped === '"' || escaped === '\\' || escaped === '/') result += escaped;
      else if (escaped === 'b') result += '\b';
      else if (escaped === 'f') result += '\f';
      else if (escaped === 'n') result += '\n';
      else if (escaped === 'r') result += '\r';
      else if (escaped === 't') result += '\t';
      else if (escaped === 'u') {
        var hex = parser.text.substr(parser.at, 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail();
        result += String.fromCharCode(parseInt(hex, 16)); parser.at += 4;
      } else fail();
    } else {
      if (value.charCodeAt(0) < 32) fail();
      result += value;
    }
  }
  fail();
}

function numberValue(parser) {
  var match = parser.text.substring(parser.at).match(/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
  if (!match) fail();
  parser.at += match[0].length;
  var value = Number(match[0]);
  if (!isFinite(value)) fail();
  return value;
}

function literal(parser, value) {
  if (parser.text.substr(parser.at, value.length) !== value) fail();
  parser.at += value.length;
}

function whitespace(parser) {
  while (parser.at < parser.text.length) {
    var code = parser.text.charCodeAt(parser.at);
    if (code !== 32 && code !== 9 && code !== 10 && code !== 13) return;
    parser.at += 1;
  }
}

function finish(parser) { whitespace(parser); if (parser.at !== parser.text.length) fail(); }
function peek(parser) { if (parser.at >= parser.text.length) fail(); return parser.text.charAt(parser.at); }
function expect(parser, value) { if (parser.text.charAt(parser.at) !== value) fail(); parser.at += 1; }
function fail() { throw new Error('ACTIVITY_HOOK_INPUT_INVALID'); }
function quit() { WScript.Quit(0); }

function stringifySafe(values, keys) {
  var parts = [];
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue;
    parts.push(jsonString(key) + ':' + jsonPrimitive(values[key]));
  }
  return '{' + parts.join(',') + '}';
}

function jsonPrimitive(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return jsonString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && isFinite(value)) return String(value);
  fail();
}

function jsonString(value) {
  var result = '"';
  for (var i = 0; i < value.length; i += 1) {
    var code = value.charCodeAt(i);
    var character = value.charAt(i);
    if (character === '"' || character === '\\') result += '\\' + character;
    else if (character === '\b') result += '\\b';
    else if (character === '\f') result += '\\f';
    else if (character === '\n') result += '\\n';
    else if (character === '\r') result += '\\r';
    else if (character === '\t') result += '\\t';
    else if (code < 32) result += '\\u' + ('000' + code.toString(16)).slice(-4);
    else result += character;
  }
  return result + '"';
}

function utf8Length(value, stopAfter) {
  var count = 0;
  for (var i = 0; i < value.length; i += 1) {
    var code = value.charCodeAt(i);
    if (code < 128) count += 1;
    else if (code < 2048) count += 2;
    else if (code >= 55296 && code <= 56319 && i + 1 < value.length && value.charCodeAt(i + 1) >= 56320 && value.charCodeAt(i + 1) <= 57343) { count += 4; i += 1; }
    else count += 3;
    if (count >= stopAfter) return count;
  }
  return count;
}

function utf8Bytes(value) {
  var bytes = [];
  for (var i = 0; i < value.length; i += 1) {
    var code = value.charCodeAt(i);
    if (code < 128) bytes.push(code);
    else if (code < 2048) bytes.push(192 | (code >> 6), 128 | (code & 63));
    else if (code >= 55296 && code <= 56319 && i + 1 < value.length) {
      var low = value.charCodeAt(i + 1);
      if (low >= 56320 && low <= 57343) {
        var point = 65536 + ((code - 55296) << 10) + (low - 56320);
        bytes.push(240 | (point >> 18), 128 | ((point >> 12) & 63), 128 | ((point >> 6) & 63), 128 | (point & 63)); i += 1;
      } else bytes.push(239, 191, 189);
    } else if (code >= 56320 && code <= 57343) bytes.push(239, 191, 189);
    else bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
  }
  return bytes;
}

function decodeUtf8Transport(value) {
  var windows1252 = {
    8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134, 8225: 135,
    710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140, 381: 142, 8216: 145,
    8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 732: 152,
    8482: 153, 353: 154, 8250: 155, 339: 156, 382: 158, 376: 159
  };
  var bytes = [];
  for (var i = 0; i < value.length; i += 1) {
    var code = value.charCodeAt(i);
    if (code <= 255) bytes.push(code);
    else if (Object.prototype.hasOwnProperty.call(windows1252, code)) bytes.push(windows1252[code]);
    else return value;
  }
  var result = '';
  for (var at = 0; at < bytes.length;) {
    var first = bytes[at++];
    if (first < 128) { result += String.fromCharCode(first); continue; }
    var needed = first >= 240 && first <= 244 ? 3 : first >= 224 ? 2 : first >= 194 ? 1 : -1;
    if (needed < 0 || at + needed > bytes.length) return value;
    var point = needed === 1 ? first & 31 : needed === 2 ? first & 15 : first & 7;
    for (var next = 0; next < needed; next += 1) {
      var continuation = bytes[at++];
      if ((continuation & 192) !== 128) return value;
      point = (point << 6) | (continuation & 63);
    }
    if ((needed === 1 && point < 128) || (needed === 2 && point < 2048) || (needed === 3 && point < 65536) || point > 1114111 || (point >= 55296 && point <= 57343)) return value;
    if (point < 65536) result += String.fromCharCode(point);
    else { point -= 65536; result += String.fromCharCode(55296 + (point >> 10), 56320 + (point & 1023)); }
  }
  return result;
}

function base64(bytes) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var result = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var first = bytes[i]; var second = i + 1 < bytes.length ? bytes[i + 1] : 0; var third = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += alphabet.charAt(first >> 2);
    result += alphabet.charAt(((first & 3) << 4) | (second >> 4));
    result += i + 1 < bytes.length ? alphabet.charAt(((second & 15) << 2) | (third >> 6)) : '=';
    result += i + 2 < bytes.length ? alphabet.charAt(third & 63) : '=';
  }
  return result;
}

function quoteCommandArgument(value) { return '"' + String(value).replace(/"/g, '""') + '"'; }
