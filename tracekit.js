// SHA: 9b7483a4e85b272fef6446a03fd0effe7c63673b

// WARNING: this is a patched version of TraceKit, with a lot of functionality removed!

/**! @preserve
 * Original CrashKit code Copyright (c) 2009 Andrey Tarantsov, YourSway LLC (http://crashkitapp.appspot.com/)
 * Copyright (c) 2010 Colin Snover (http://zetafleet.com)
 *
 * Released under the ISC License.
 * http://opensource.org/licenses/isc-license.txt
 */
var TraceKit = {};

/**
 * TraceKit.computeStackTrace: cross-browser stack traces in JavaScript
 *
 * Syntax:
 *   s = TraceKit.computeStackTrace.ofCaller([depth])
 *   s = TraceKit.computeStackTrace(exception) // consider using TraceKit.report instead (see below)
 * Returns:
 *   s.name              - exception name
 *   s.message           - exception message
 *   s.stack[i].url      - JavaScript or HTML file URL
 *   s.stack[i].func     - function name, or empty for anonymous functions (if guessing did not work)
 *   s.stack[i].args     - arguments passed to the function, if known
 *   s.stack[i].line     - line number, if known
 *   s.stack[i].column   - column number, if known
 *   s.stack[i].context  - an array of source code lines; the middle element corresponds to the correct line#
 *   s.mode              - 'stack', 'stacktrace', 'multiline', 'callers', 'onerror', or 'failed' -- method used to collect the stack trace
 *
 * Supports:
 *   - Firefox:  full stack trace with line numbers and unreliable column
 *               number on top frame
 *   - Opera 10: full stack trace with line and column numbers
 *   - Opera 9-: full stack trace with line numbers
 *   - Chrome:   full stack trace with line and column numbers
 *   - Safari:   line and column number for the topmost stacktrace element
 *               only
 *   - IE:       no line numbers whatsoever
 *
 * Tries to guess names of anonymous functions by looking for assignments
 * in the source code. In IE and Safari, we have to guess source file names
 * by searching for function bodies inside all page scripts. This will not
 * work for scripts that are loaded cross-domain.
 * Here be dragons: some function names may be guessed incorrectly, and
 * duplicate functions may be mismatched.
 *
 * TraceKit.computeStackTrace should only be used for tracing purposes.
 * Logging of unhandled exceptions should be done with TraceKit.report,
 * which builds on top of TraceKit.computeStackTrace and provides better
 * IE support by utilizing the window.onerror event to retrieve information
 * about the top of the stack.
 *
 * Note: In IE and Safari, no stack trace is recorded on the Error object,
 * so computeStackTrace instead walks its *own* chain of callers.
 * This means that:
 *  * in Safari, some methods may be missing from the stack trace;
 *  * in IE, the topmost function in the stack trace will always be the
 *    caller of computeStackTrace.
 *
 * This is okay for tracing (because you are likely to be calling
 * computeStackTrace from the function you want to be the topmost element
 * of the stack trace anyway), but not okay for logging unhandled
 * exceptions (because your catch block will likely be far away from the
 * inner function that actually caused the exception).
 *
 * Tracing example:
 *     function trace(message) {
 *         var stackInfo = TraceKit.computeStackTrace.ofCaller();
 *         var data = message + "\n";
 *         for(var i in stackInfo.stack) {
 *             var item = stackInfo.stack[i];
 *             data += (item.func || '[anonymous]') + "() in " + item.url + ":" + (item.line || '0') + "\n";
 *         }
 *         if (window.console)
 *             console.info(data);
 *         else
 *             alert(data);
 *     }
 */
TraceKit.computeStackTrace = (function () {
  var debug = false;

  // Contents of Exception in various browsers.
  //
  // SAFARI:
  // ex.message = Can't find variable: qq
  // ex.line = 59
  // ex.sourceId = 580238192
  // ex.sourceURL = http://...
  // ex.expressionBeginOffset = 96
  // ex.expressionCaretOffset = 98
  // ex.expressionEndOffset = 98
  // ex.name = ReferenceError
  //
  // FIREFOX:
  // ex.message = qq is not defined
  // ex.fileName = http://...
  // ex.lineNumber = 59
  // ex.stack = ...stack trace... (see the example below)
  // ex.name = ReferenceError
  //
  // CHROME:
  // ex.message = qq is not defined
  // ex.name = ReferenceError
  // ex.type = not_defined
  // ex.arguments = ['aa']
  // ex.stack = ...stack trace...
  //
  // INTERNET EXPLORER:
  // ex.message = ...
  // ex.name = ReferenceError
  //
  // OPERA:
  // ex.message = ...message... (see the example below)
  // ex.name = ReferenceError
  // ex.opera#sourceloc = 11  (pretty much useless, duplicates the info in ex.message)
  // ex.stacktrace = n/a; see 'opera:config#UserPrefs|Exceptions Have Stacktrace'

  /**
   * Computes stack trace information from the stack property.
   * Chrome and Gecko use this property.
   * @param {Error} ex
   * @return {?Object.<string, *>} Stack trace information.
   */
  function computeStackTraceFromStackProp(ex) {
    if (!ex.stack) {
      return null;
    }

    var chrome = /^\s*at (\S+) \(((?:file|http|https):.*?):(\d+)(?::(\d+))?\)\s*$/i,
      gecko = /^\s*(\S*)(?:\((.*?)\))?@((?:file|http|https).*?):(\d+)(?::(\d+))?\s*$/i,
      lines = ex.stack.split("\n"),
      stack = [],
      parts,
      element,
      reference = /^(.*) is undefined$/.exec(ex.message);

    for (var i = 0, j = lines.length; i < j; ++i) {
      if ((parts = gecko.exec(lines[i]))) {
        element = { 'url': parts[3], 'func': parts[1], 'args': parts[2] ? parts[2].split(',') : '', 'line': +parts[4], 'column': parts[5] ? +parts[5] : null };
      }
      else if ((parts = chrome.exec(lines[i]))) {
        element = { 'url': parts[2], 'func': parts[1], 'line': +parts[3], 'column': parts[4] ? +parts[4] : null };
      }
      else {
        continue;
      }

      stack.push(element);
    }

    if (!stack.length) {
      return null;
    }

    return {
      'mode': 'stack',
      'name': ex.name,
      'message': ex.message,
      'stack': stack
    };
  }

  /**
   * Computes stack trace information from the stacktrace property.
   * Opera 10 uses this property.
   * @param {Error} ex
   * @return {?Object.<string, *>} Stack trace information.
   */
  function computeStackTraceFromStacktraceProp(ex) {
    // Access and store the stacktrace property before doing ANYTHING
    // else to it because Opera is not very good at providing it
    // reliably in other circumstances.
    var stacktrace = ex.stacktrace;

    var testRE = / line (\d+), column (\d+) in (?:<anonymous function: ([^>]+)>|([^\)]+))\((.*)\) in (.*):\s*$/i,
      lines = stacktrace.split("\n"),
      stack = [],
      parts;

    for (var i = 0, j = lines.length; i < j; i += 2) {
      if ((parts = testRE.exec(lines[i]))) {
        var element = { 'line': +parts[1], 'column': +parts[2], 'func': parts[3] || parts[4], 'args': parts[5] ? parts[5].split(',') : [], 'url': parts[6] };

        if (!element.context) {
          element.context = [ lines[i + 1] ];
        }

        stack.push(element);
      }
    }

    if (!stack.length) {
      return null;
    }

    return {
      'mode': 'stacktrace',
      'name': ex.name,
      'message': ex.message,
      'stack': stack
    };
  }

  /**
   * NOT TESTED.
   * Computes stack trace information from an error message that includes
   * the stack trace.
   * Opera 9 and earlier use this method if the option to show stack
   * traces is turned on in opera:config.
   * @param {Error} ex
   * @return {?Object.<string, *>} Stack information.
   */
  function computeStackTraceFromOperaMultiLineMessage(ex) {
    // Opera includes a stack trace into the exception message. An example is:
    //
    // Statement on line 3: Undefined variable: undefinedFunc
    // Backtrace:
    //   Line 3 of linked script file://localhost/Users/andreyvit/Projects/TraceKit/javascript-client/sample.js: In function zzz
    //         undefinedFunc(a);
    //   Line 7 of inline#1 script in file://localhost/Users/andreyvit/Projects/TraceKit/javascript-client/sample.html: In function yyy
    //           zzz(x, y, z);
    //   Line 3 of inline#1 script in file://localhost/Users/andreyvit/Projects/TraceKit/javascript-client/sample.html: In function xxx
    //           yyy(a, a, a);
    //   Line 1 of function script
    //     try { xxx('hi'); return false; } catch(ex) { TraceKit.report(ex); }
    //   ...

    var lines = ex.message.split('\n');
    if (lines.length < 4) {
      return null;
    }

    var lineRE1 = /^\s*Line (\d+) of linked script ((?:file|http|https)\S+)(?:: in function (\S+))?\s*$/i,
      lineRE2 = /^\s*Line (\d+) of inline#(\d+) script in ((?:file|http|https)\S+)(?:: in function (\S+))?\s*$/i,
      lineRE3 = /^\s*Line (\d+) of function script\s*$/i,
      stack = [],
      parts,
      i,
      len;

    for (i = 2, len = lines.length; i < len; i += 2) {
      var item = null;
      if ((parts = lineRE1.exec(lines[i]))) {
        item = { 'url': parts[2], 'func': parts[3], 'line': +parts[1] };
      }

      if (item) {
        item.context = [lines[i + 1]];
        stack.push(item);
      }
    }
    if (!stack.length) {
      return null; // could not parse multiline exception message as Opera stack trace
    }

    return {
      'mode': 'multiline',
      'name': ex.name,
      'message': lines[0],
      'stack': stack
    };
  }

  /**
   * Computes a stack trace for an exception.
   * @param {Error} ex
   * @param {(string|number)=} depth
   */
  function computeStackTrace(ex, depth) {
    var stack = null;
    depth = (depth === undefined ? 0 : +depth);

    try {
      // This must be tried first because Opera 10 *destroys*
      // its stacktrace property if you try to access the stack
      // property first!!
      stack = computeStackTraceFromStacktraceProp(ex);
      if (stack) {
        return stack;
      }
    }
    catch (e) {
      if (debug) {
        throw e;
      }
    }

    try {
      stack = computeStackTraceFromStackProp(ex);
      if (stack) {
        return stack;
      }
    }
    catch (e) {
      if (debug) {
        throw e;
      }
    }

    try {
      stack = computeStackTraceFromOperaMultiLineMessage(ex);
      if (stack) {
        return stack;
      }
    }
    catch (e) {
      if (debug) {
        throw e;
      }
    }

    return { 'mode': 'failed' };
  }

  /**
   * Logs a stacktrace starting from the previous call and working down.
   * @param {(number|string)=} depth How many frames deep to trace.
   * @return {Object.<string, *>} Stack trace information.
   */
  function computeStackTraceOfCaller(depth) {
    depth = (depth === undefined ? 0 : +depth) + 1; // "+ 1" because "ofCaller" should drop one frame
    try {
      (0)();
    }
    catch (ex) {
      return computeStackTrace(ex, depth + 1);
    }

    return null;
  }

  computeStackTrace.ofCaller = computeStackTraceOfCaller;

  return computeStackTrace;
}());
