/**
ComboHandler.Cluster

@author Daniel Stockman <daniel.stockman@gmail.com>
**/

var cluster = require('cluster'),
    fs = require('fs'),
    path = require('path'),

    // support `npm start combohandler` or `node server.js &`
    prefixDir = process.env.npm_config_prefix || path.resolve(path.dirname(process.execPath), '..'),
    runDir = prefixDir + '/var/run',

    libutil = require('./utils');

/**
A factory for running combohandler in multiple processes.

@class ComboCluster
@constructor
@param {Object} config
**/
var ComboCluster = module.exports = function ComboCluster(config) {
    // factory constructor
    if (!(this instanceof ComboCluster)) {
        return new ComboCluster(config);
    }

    // merge config with defaults
    var opts = this.options = libutil.merge(ComboCluster.defaults, config);

    if (opts.restart) {
        this.restart();
    }
    else if (opts.shutdown) {
        this.shutdown();
    }
    else if (opts.status) {
        this.status();
    }
    else if (opts.stop) {
        this.stop();
    }
    else {
        this.listen();
    }
};

ComboCluster.defaults = {
    basePath: process.cwd(),
    port: 3000,
    server: './server',
    workers: require('os').cpus().length
};

ComboCluster.prototype = {

    _resolveRoots: function (config) {
        var config = this.options;

        // parse roots json config
        if (config.rootsFile) {
            config.roots = require(config.rootsFile);
            // prepend basePath to root values
            for (var root in config.roots) {
                config.roots[root] = path.resolve(config.basePath, config.roots[root]);
            }
        }
    },

    start: function (startCallback) {
        if (cluster.isMaster) {
            this._initMaster(startCallback);
        }
        else {
            this._initWorker(startCallback);
        }

        return this;
    },

    _initMaster: function (masterCallback) {
        // this doesn't work in OS X (node-v0.8.x), but whatever
        process.title = 'combohandler master';

        this._setupMasterPidFiles();
        this._setupMasterSignals();
        this._setupMasterCluster();

        if (masterCallback) {
            masterCallback();
        }
    },

    _initWorker: function (workerCallback) {
        // this doesn't work in OS X (node-v0.8.x), but whatever
        process.title = 'combohandler worker';

        if (workerCallback) {
            workerCallback();
        }
    },

    _setupMasterPidFiles: function () {
        // ensure runDir exists before writing the pidfile
        if (!fs.existsSync(runDir)) {
            require('mkdirp').sync(runDir);
        }

        writePidFile('master', process.pid);
    },

    _setupMasterSignals: function () {
        process.on('SIGINT',  gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGUSR2', restartWorkers);
    },

    _setupMasterCluster: function () {
        // TODO: configurable
        var timeouts = [],
            flameouts = 0;

        cluster.on('fork', function (worker) {
            timeouts[worker.id] = setTimeout(function () {
                console.error('Something is wrong with worker ' + worker.id);
            }, 2000);
        });

        cluster.on('listening', function (worker) {
            console.log('Worker ' + worker.id + ' listening with pid ' + worker.process.pid);
            clearTimeout(timeouts[worker.id]);

            // this doesn't work in OS X, but whatever
            worker.process.title = 'combohandler worker';
            writePidFile('worker' + worker.id, worker.process.pid);
        });

        cluster.on('exit', function (worker, code, signal) {
            clearTimeout(timeouts[worker.id]);

            if (signal) {
                console.error('Worker ' + worker.id + ' received signal ' + signal);
            }

            if (code) {
                // oddly, SIGINT will pass exitCode=1 here, but suicide=true
                console.error('Worker ' + worker.id + ' exited with code ' + code);
                if (++flameouts > 20) {
                    console.error("Too many errors during startup, bailing!");
                    process.exit(1);
                }
            }

            if (worker.suicide) {
                console.log('Worker ' + worker.id + ' exited cleanly.');
                removePidFile('worker' + worker.id);
            } else {
                console.warn('Worker ' + worker.id + ' died, respawning!');
                cluster.fork();
            }
        });
    },

    restart: function () {
        sendSignalToMaster('SIGUSR2');
    },

    status: function () {
        outputWorkerStatus();
    },

    shutdown: function () {
        sendSignalToMaster('SIGTERM');
    },

    stop: function () {
        // must clean up worker pidfiles before sending SIGKILL,
        // because SIGKILL listeners basically can't do anything
        removeWorkerPidFiles(function () {
            console.error('combohandler master ' + process.pid + ' stopping abruptly...');
            sendSignalToMaster('SIGKILL');
        });
    },

    _listen: function () {
        if (cluster.isMaster) {
            // fork
            console.log('\nForking workers from combohandler master ' + process.pid);
            var workers = this.options.workers;
            while (workers--) {
                cluster.fork();
            }
        }
        else {
            // listen
            var server = this.options.server;
            if (server) {
                require(server)(this.options).listen(this.options.port);
            }
        }
    },

    /**
    Listen to a port.

    @method listen
    @param {Number} [port]
    @public
    **/
    listen: function (port) {
        if (port) {
            this.options.port = port;
        }

        this._resolveRoots();

        return this.start(this._listen.bind(this));
    }

};

// Manage combohandler process master and worker pidfiles
// https://github.com/LearnBoost/cluster/blob/master/lib/plugins/pidfiles.js
function getPidFilePath(name) {
    return path.join(runDir, (name || 'master') + '.pid');
}

function getPidSync(name) {
    return parseInt(fs.readFileSync(getPidFilePath(name)), 10);
}

function getMasterPid(cb) {
    fs.readFile(getPidFilePath('master'), function (err, pid) {
        if (pid) {
            pid = parseInt(pid, 10);
        }
        if (cb) {
            cb(err, pid);
        }
    });
}

function getWorkerPidFilesSync() {
    return fs.readdirSync(runDir).filter(function (file) {
        return file.match(/^worker.*\.pid$/);
    });
}

function getWorkerPidsSync() {
    return getWorkerPidFilesSync().map(function (file) {
        return parseInt(fs.readFileSync(runDir + '/' + file), 10);
    });
}

function writePidFile(name, pid) {
    fs.writeFile(getPidFilePath(name), pid.toString(), function (err) {
        if (err) { throw err; }
    });
}

function removePidFile(name, cb) {
    fs.unlink(getPidFilePath(name), function (err) {
        if (cb) {
            cb(err);
        }
        else if (err) {
            if ('ENOENT' === err.code) {
                console.error('Could not find pidfile: ' + err.msg);
            }
            else {
                throw err;
            }
        }
    });
}

function removePidFileSync(name) {
    fs.unlinkSync(getPidFilePath(name));
}

function removeWorkerPidFiles(cb) {
    var workerPidFiles = getWorkerPidFilesSync(),
        remaining = workerPidFiles.length;

    workerPidFiles.forEach(function (file) {
        removePidFile(file.replace(/\.pid$/, ''), function (err) {
            if (err) {
                if ('ENOENT' === err.code) {
                    console.error('Could not find worker pidfile: ' + file);
                }
                else {
                    throw err;
                }
            }
            if (--remaining === 0 && cb) {
                cb();
            }
        });
    });
}


function logStatus(name, pid, status, color) {
    console.log('%s\033[90m %d\033[0m \033[' + color + 'm%s\033[0m', name, pid, status);
}

function checkStatus(prefix, pid, suffix) {
    // increment zero-based forEach index to match one-based worker.id
    if (typeof suffix === 'number') {
        suffix += 1;
    }

    var name = prefix + suffix,
        status = 'alive',
        color = '36';

    try {
        process.kill(pid, 0);
    }
    catch (err) {
        if ('ESRCH' === err.code) {
            status = 'dead';
            color = '31';
        }
        else {
            throw err;
        }
    }

    logStatus(name, pid, status, color);
}

function outputWorkerStatus() {
    getMasterPid(function (err, masterPid) {
        if (err) {
            if ('ENOENT' === err.code) {
                console.error('combohandler master not running!');
                process.exit(1);
            }
            else {
                throw err;
            }
        }

        checkStatus('master', masterPid, '');

        getWorkerPidsSync().forEach(checkStatus.bind({}, 'worker'));
    });
}


function sendSignalToMaster(signal) {
    getMasterPid(function (err, masterPid) {
        if (err) {
            console.error("Error sending signal " + signal + " to combohandler master process");
            throw err;
        } else {
            try {
                // again, because SIGKILL is so incredibly rude,
                // he doesn't allow us to do anything afterward
                if ('SIGKILL' === signal) {
                    removePidFileSync('master');
                }
                // send signal to master process, not necessarily "killing" it
                process.kill(masterPid, signal);
            }
            catch (ex) {
                if ('ESRCH' === ex.code) {
                    console.error('combohandler not running');
                }
                else {
                    throw ex;
                }
            }
        }
    });
}

// Signal Event Handlers
// http://nodejs.org/api/process.html#process_signal_events
// http://en.wikipedia.org/wiki/Unix_signal#List_of_signals

// SIGINT   (Ctrl+C)
// SIGTERM  (default signal from `kill`)
function gracefulShutdown() {
    console.log('combohandler master ' + process.pid + ' shutting down...');
    cluster.disconnect(removePidFile);
}

// SIGUSR2
function restartWorkers() {
    console.log('combohandler master ' + process.pid + ' restarting workers...');
    for (var id in cluster.workers) {
        if (cluster.workers.hasOwnProperty(id)) {
            process.kill(cluster.workers[id].process.pid, 'SIGUSR2');
        }
    }
}
