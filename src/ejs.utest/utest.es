/*
    utest.es -- Embedthis Unit Test Framework
 */
module ejs.test {

require ejs.unix

enumerable class Test {

    use default namespace public

    var args: Args
    var options: Object

    var verbosity: Number = 0               // Verbosity level
    const TIMEOUT: Number = 15 * 60 * 1000  // Test timeout (15 minutes)

    /*
         Directories to omit from unit tests
     */
    const skipDirs = [ "extensions", "out", "build", "package", "projects", "samples", "releases" ]

    /*
        Parsed args
        TODO - don't need to store separate to options.
     */
    var _cfg: Path?                         // Path to configuration outputs directory
    var _bin: Path                          // Path to bin directory
    var _depth: Number = 1                  // Test level. Higher levels mean deeper testing.
    //  TODO - remove
    var _lib: Path                          // Path to lib directory
    var _top: Path                          // Path to top of source tree

    var continueOnErrors: Boolean = false   // Continue on errors 
    var data: Object                        // Opaque data
    var echo: Boolean = false               // Echo the command line 
    var errorMsg: String                    // Worker callback error msg
    var failed: Boolean                     // Did the test pass
    var env: Object                         // Environment
    var features: Object                    // me.h features
    var filters: Array = []                 // Filter tests by pattern x.y.z... 
    var finish: Boolean                     // Set to true when time to exit 
    var iterations: Number = 1              // Number of iterations to run the test 
    var nth: Number = 0                     // Current iteration
    var noserver: Boolean = false           // Omit running a server (sets NOSERVER=1)
    var originalHome: Path                  // Original home directory for utest
    var second: Boolean = false             // Second instance. Bypass some initializations
    var skipTest: Boolean = false           // Skip a test
    var skippedMsg: String?                 // Test skipped message
    var step: Boolean = false               // Single step tests 
    var testName: String                    // Set test name 
    var testDirs: Array = [ "." ]           // Test directories to run
    var threads: Number = 1                 // Number of test threads 
    var version: String = "0.1.0"           // Output version information 
    var workerImage: Worker                 // Clonable worker image

    var program: String                     // Program name
    var currentTest: String                 // Test currently executing
    var fullName: String                    // Full name of the current test 
    var log: Logger = App.log
    var out: Stream
    var start = Date.now()

    /*
        Stats
     */
    var assertCount: Number = 0
    var failedCount: Number = 0
    var passedCount: Number = 0
    var skippedCount: Number = 0
    var testCount: Number = 0

    /*
        Test session data provided via share()
     */
    var session = { }
        
    let argsTemplate = {
        options: {
            chdir: { range: Path },
            'continue': { alias: 'c' },
            depth: { alias: 'd', range: Number },
            debug: { alias: 'D' },
            echo: { alias: 'e' },
            iterations: { alias: 'i', range: Number },
            log: { alias: 'l', range: String },
            name: { range: String },
            noserver: { alias: 'n' },
            os: { alias: 'o', range: String },
            second: { alias: '2' },
            step: { alias: 's' },
            threads: { alias: 't', range: Number },
            verbose: { alias: 'v' },
            version: { alias: 'V' },
        },
        usage: usage,
    }

    function usage(): Void {
        let program = Path(App.args[0]).basename
        App.log.error("Usage: " + program + " [options] [filter patterns...]\n" +
            "  --chdir dir           # Change to directory before testing\n" + 
            "  --continue            # Continue on errors\n" + 
            "  --depth number        # Zero == basic, 1 == throrough, 2 extensive\n" + 
            "  --debug               # Run in debug mode\n" + 
            "  --echo                # Echo the command line\n" + 
            "  --iterations count    # Number of iterations to run the test\n" + 
            "  --log logSpec         # Control debug logging\n" + 
            "  --name testName       # Set test name\n" + 
            "  --noserver            # Don't run server side of tests\n" + 
            "  --os O/S              # Set operating system\n" + 
            "  --out path            # Save output to a file\n" + 
            "  --second              # Second instance. Bypass some initializations\n" + 
            "  --step                # Single step tests\n" + 
            "  --threads count       # Number of test threads\n" + 
            "  --verbose             # Verbose mode\n" + 
            "  --version             # Output version information\n")
        App.exit(1)
    }

    /*
        Parse args and invoke required commands
     */
    function parseArgs(): Void {
        originalHome = App.dir
        args = Args(argsTemplate, App.args)
        options = args.options
        filters += args.rest

        if (options.second) {
            second = true
            noserver = true
            App.putenv("SECOND", "1")
            App.putenv("NOSERVER", "1")
        }
        if (options.chdir) {
            App.chdir(options.chdir)
        }
        if (options['continue']) {
            continueOnErrors = true
        }
        if (options.depth) {
            _depth = options.depth
            if (_depth < 1 || _depth > 9) {
                _depth = 1
            }
        }
        if (options.debug) {
            Debug.mode = true
        }
        if (options.echo) {
            echo = true
        }
        if (options.iterations) {
            iterations = options.iterations
        }
        if (options.noserver) {
            noserver = true
            App.putenv("NOSERVER", "1")
        }
        if (options.name) {
            testName = options.name
        }
        if (options.step) {
            step = true
        }
        if (options.threads) {
            threads = options.threads
        }
        if (options.verbose) {
            verbosity++
        }
        if (options.version) {
            print(program.toString().toPascal() + " " + options.version)
            App.exit()
        }
    }

    function initialize(): Void {
        if (options.log) {
            App.log.redirect(options.log)
            App.mprLog.redirect(options.log)
        }
        out = (options.out) ? File(options.out, "w") : stdout
        if (echo) {
            activity("Test", App.args.join(" "))
        }
    }

    function Test() {
        workerImage = new Worker
        program = Path(App.args[0]).basename
        if ((path = searchUp("configure")) == null) {
            throw "Cannot find configure"
        }
        _top = path.dirname.absolute
        try {
            if (_top.join('start.me')) {
                _cfg = _top.join('build', Cmd.run('me --showPlatform', {dir: _top}).trim())
            }
        } catch {}
        if (!_cfg) {
            _cfg = _top.join('build').files(Config.OS + '-' + Config.CPU + '-*').sort()[0]
            if (!_cfg) {
                let hdr = _top.files('build/*/inc/me.h').sort()[0]
                if (!hdr) {
                    let hdr = _top.files('*/inc/bit.h').sort()[0]
                    if (!hdr) {
                        throw 'Cannot locate configure files, run configure'
                    }
                    _cfg = hdr.trimEnd('/inc/bit.h')
                } else {
                    _cfg = hdr.trimEnd('/inc/me.h')
                }
            }
        }
        if (_cfg.join('inc/me.h').exists) {
            parseMeConfig(_cfg.join('inc/me.h'))
        } else if (_cfg.join('inc/bit.h').exists) {
            parseBitConfig(_cfg.join('inc/bit.h'))
        } else {
            throw 'Cannot locate configure files, run configure'
        }
        _bin = _lib = _cfg.join('bin')
        App.putenv('PATH', _bin + App.SearchSeparator + App.getenv('PATH'))
    }

    /*
        Main test runner
     */
    function runner(): Void {
        activity("Test", "Starting tests. Test depth: " + _depth + ", iterations: " + iterations)
        for (i in testDirs) {
            testDirs[i] = new Path(testDirs[i])
        }
        let success = false
        try {
            runThread()
	    	success = true
        }
        finally {
            if (!success && test.verbosity == 1 && test.threads <= 1) {
                out.write("FAILED\n")
            }
        }
    }

    function runThread(): Void {
        for (nth = 0; nth < iterations && !finish; nth++) {
            for each (dir in testDirs) {
                runGroupTests(dir)
            }
            activity("Progress", "Completed iteration " + nth)
        }
    }

    function runGroupTests(dir: Path): Void {
        if (dir != "." && dir.name.startsWith(".")) {
            return
        }
        if (skipDirs.contains(dir.toString())) {
            return
        }
        let saveConfig
        if (dir.join("ejsrc").exists) {
            saveConfig = App.config.clone()
            App.loadrc(dir.join("ejsrc"), false)
        }
        if (!runSetup(dir, "init")) {
            if (saveConfig) {
                App.config = saveConfig
            }
            return
        }
        try {
            if (!dir.exists) {
                error("Cannot read directory: " + dir)
            }
            for each (file in ls(dir)) {
                if (finish) { 
                    break
                }
                if (filters.length > 0) {
                    let found
                    for each (let filter: Path in filters) {
                        if (file.isDir && filter.startsWith(file)) {
                            found = true
                            break
                        }
                        if (file.startsWith(filter)) {
                            found = true
                            break
                        }
                    }
                    if (!found) {
                        continue
                    }
                }
                if (file.isDir) {
                    runGroupTests(file)
                } else if (file.extension == "tst") {
                    runTest(file)
                }
            }
        } finally {
            if (saveConfig) {
                App.config = saveConfig
            }
            runSetup(dir, "term")
        }
    }

    function runTest(file: Path, phase: String? = null): Void {
        skipTest = false
        let home = App.dir
        try {
            logTest(file)
            App.chdir(file.dirname)
            file = file.basename
            let workers
            let ext = file.extension
            if (ext == "init" || ext == "term") {
                workers = startWorker(file, phase)
            } else {
                workers = []
                for (thread in threads) {
                    workers.append(startWorker(file, phase))
                }
            }
            if (!Worker.join(workers, TIMEOUT)) {
                for each (w in workers) {
                    w.terminate()
                }
                Worker.join(workers, 0)
                throw "Test Failed: \"" + test.fullName + "\". Timeout of " + TIMEOUT + " expired."
            }
            workers = null
        } catch (e) {
            failedCount++
            if (!continueOnErrors) {
                finish = true
                throw e
            }
        } finally {
            App.chdir(home)
        }
        GC.run()
    }

    function initWorker(w: Worker, export: Object) {
        let uarg = Path(App.args[0])
        if (uarg.exists) {
            w.preload(uarg.replaceExt('.worker'))
        } else {
            w.preload(App.exeDir.join("utest.worker"))
        }
        let estr = serialize(export)
        w.preeval('
            let data = deserialize(\'' + estr.replace(/\\/g, "\\\\") + '\')
            public var test: Test = new Test
            App.test = test
            test.depth = data.depth
            test.cfg = Path(data.cfg)
            test.bin = Path(data.bin)
            test.dir = Path(data.dir)
            test.lib = Path(data.lib)
            test.env = data.env
            test.features = data.features
            test.phase = data.phase
            test.session = data.session
            test.threads = data.threads
            test.top = Path(data.top)
            test.verbosity = Number(data.verbosity)
            blend(App.config, data.features)
            blend(App.config.uris, data.uris)
            blend(App.config.dirs, data.dirs)
        ')
    }

    function startWorker(file: Path, phase: String? = null): Worker {
        let export = { 
            cfg: _cfg, 
            bin: _bin, 
            depth: _depth, 
            dir: file.dirname,
            env: env,
            features: features,
            lib: _lib, 
            phase: phase,
            session: session,
            threads: threads, 
            top: _top, 
            uris: App.config.uris, 
            dirs: App.config.dirs, 
            verbosity: verbosity, 
        }
        let w: Worker = workerImage.clone()
        w.name = fullName
        initWorker(w, export)

        let priorCount = testCount
        let test = this
        test.failed = false
        w.onmessage = function (e) {
            obj = deserialize(e.data)
            if (obj.passed) {
                test.passedCount++
                test.testCount++
            } else if (obj.skip) {
                test.skipTest = true
                test.skippedMsg = obj.skip
                test.skippedCount++
            } else if (obj.key) {
                test.session[obj.key] = obj.value
            } else if (obj.uri) {
                App.config.uris[obj.uri] = obj.value
            }
        }
        w.onerror = function (e) {
            if (test.verbosity == 1 && test.threads <= 1) {
                out.write("FAILED\n\n")
            }
            test.failed = true
            test.failedCount++
            if (e.stack) {
                test.testCount++
                let stack = e.formatStack()
                if (!test.continueOnErrors) {
                    test.finish = true
                    out.write("Test Failed: \"" + test.fullName + "\". " + e.message + " At:\n" + stack + "\n")
                }
            } else {
                out.write("Test Failed: " + e.message + "\n")
            }
        }
        let out = this.out
        w.onclose = function (e) {
            if (test.testCount == priorCount) {
                /*
                    Test did not invoke assert. At least it did not crash, so count it as passed.
                 */
                test.passedCount++
                test.testCount++
            }
            if (test.verbosity == 1 && test.threads <= 1) {
                if (test.skippedMsg) {
                    out.write("SKIPPED (" + test.skippedMsg + ")\n")
                    test.skippedMsg = null
                } else if (!test.failed) {
                    out.write("PASSED\n")
                }
            }
        }
        w.load(file)
        return w
    }

    /*
        Run a test.setup script. If it calls skip(), 
        then return skip so the whole directory can be skipped.
     */
    function runSetup(path: Path, phase: String): Boolean {
        let file = path.join("test.setup")
        if (file.exists) {
            runTest(file, phase)
            return !skipTest 
        }
        return true
    }

    function summary() {
        activity("Test", ((failedCount == 0) ? "PASSED" : "FAILED") + ": " + 
            testCount + " tests completed, " + failedCount +
            " tests(s) failed, " + skippedCount + " tests(s) skipped. " + 
            "Elapsed time " + ("%.2f" % ((Date.now() - start) / 1000)) + " secs.")
    }

    function exit(): Void {
        App.exit(failedCount > 0 ? 1 : 0)
    }

    function logTest(file: Path): Void {
        let ext = file.extension
        if (ext == "init" || ext == "term") {
            prefix = "[" + ext.toPascal() + "]"
            // currentTest = file.dirname.joinExt(ext).toString().replace(/\//, ".")
        } else {
            prefix = "[Test]"
            // currentTest = file.trimExt().toString().replace(/\//g, ".")
        }
        currentTest = file.toString()
        this.fullName = testName ? (testName + "." + currentTest) : currentTest
        if (verbosity || step) {
            out.write("%12s " % prefix)
        }
        if (step) {
            out.write(fullName + ", press <ENTER>: ")
            if (step) stdin.readLine()
        } else if (verbosity > 0) {
            out.write(fullName)
            if (verbosity == 1 && threads == 1) {
                out.write(" ... ")
            }
        }
        if (verbosity > 1 || threads > 1) {
            out.write("\n")
        }
    }
        
    function getKey(data: String, key: String): String? {
        r = RegExp(key + "=(.*)")
        match = data.match(r)
        if (match) {
            return match[0].split("=")[1]
        }
        return null
    }

    function parseBitConfig(path: Path) {
        let data = Path(path).readString()
        features = {}
        let str = data.match(/BIT_.*/g)
        for each (item in str) {
            let [key, value] = item.split(" ")
            key = key.replace(/BIT_PACK_/, "")
            key = key.replace(/BIT_/, "").toLowerCase()
            if (value == "1" || value == "0") {
                value = value cast Number
            }
            features["bit_" + key] = value
        }
        str = data.match(/export.*/g)
        env = {}
        for each (item in str) {
            if (!item.contains("=")) {
                continue
            }
            let [key, value] = item.split(":=")
            key = key.replace(/export /, "")
            env[key] = value
        }
    }

    function parseMeConfig(path: Path) {
        let data = Path(path).readString()
        features = {}
        let str = data.match(/ME_.*/g)
        for each (item in str) {
            let [key, value] = item.split(" ")
            key = key.replace(/ME_COM_/, "")
            key = key.replace(/ME_/, "").toLowerCase()
            if (value == "1" || value == "0") {
                value = value cast Number
            }
            features["me_" + key] = value
        }
        str = data.match(/export.*/g)
        env = {}
        for each (item in str) {
            if (!item.contains("=")) {
                continue
            }
            let [key, value] = item.split(":=")
            key = key.replace(/export /, "")
            env[key] = value
        }
    }

    function searchUp(path: Path): Path? {
        if (path.exists && !path.isDir) {
            return path
        }
        path = Path(path).relative
        dir = Path("..")
        while (true) {
            up = Path(dir.relative).join(path)
            if (up.exists && !up.isDir) {
                return up
            }
            if (dir.parent == dir) {
                break
            }
            dir = dir.parent
        }
        return null
    }

    function error(...msg): Void {
        App.log.error("\nutest: " + msg + "\n\n")
        App.exit(1)
    }

//  TODO - rename tor trace
    function activity(tag: String, ...args): Void {
        let msg = args.join(" ")
        let msg = "%12s %s" % (["[" + tag + "]"] + [msg]) + "\n"
        out.write(msg)
    }
}

/*
    Main program
 */
var test: Test = new Test
test.parseArgs()
test.initialize()

try {
    test.runner()
} catch (e) { 
    App.log.error(e)
}
test.summary()
test.exit()

} /* module ejs.test */

/*
    @copy   default

    Copyright (c) Embedthis Software. All Rights Reserved.

    This software is distributed under commercial and open source licenses.
    You may use the Embedthis Open Source license or you may acquire a 
    commercial license from Embedthis Software. You agree to be fully bound
    by the terms of either license. Consult the LICENSE.md distributed with
    this software for full details and other copyrights.

    Local variables:
    tab-width: 4
    c-basic-offset: 4
    End:
    vim: sw=4 ts=4 expandtab

    @end
 */
