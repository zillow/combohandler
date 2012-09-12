/**
ComboHandler.Cluster

@author Daniel Stockman <daniel.stockman@gmail.com>
**/

var cluster = require('cluster'),
    fs = require('fs'),
    path = require('path'),
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
    pids: defaultPidsDir(),
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
        var dir = this.options.pids;

        // ensure pids dir exists before writing the pidfile
        if (!fs.existsSync(dir)) {
            require('mkdirp').sync(dir);
        }

        writePidFile(dir, 'master', process.pid);
    },

    _setupMasterSignals: function () {
        // bind shutdown helper to access this.options.pids
        var boundGracefulShutdown = this.gracefulShutdown.bind(this);

        process.on('SIGINT',  boundGracefulShutdown);
        process.on('SIGTERM', boundGracefulShutdown);
        process.on('SIGUSR2', this.restartWorkers);
    },

    _setupMasterCluster: function () {
        // TODO: configurable
        var timeouts = [],
            flameouts = 0,
            pids = this.options.pids;

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
            writePidFile(pids, 'worker' + worker.id, worker.process.pid);
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
                removePidFile(pids, 'worker' + worker.id);
            } else {
                console.warn('Worker ' + worker.id + ' died, respawning!');
                cluster.fork();
            }
        });
    },

    // Signal Event Handlers
    // http://nodejs.org/api/process.html#process_signal_events
    // http://en.wikipedia.org/wiki/Unix_signal#List_of_signals

    // SIGINT   (Ctrl+C)
    // SIGTERM  (default signal from `kill`)
    gracefulShutdown: function () {
        if (cluster.isMaster) {
            console.log('combohandler master ' + process.pid + ' shutting down...');
            var dir = this.options.pids;
            cluster.disconnect(function () {
                removePidFile(dir, 'master');
            });
        }
    },

    // SIGUSR2
    restartWorkers: function () {
        if (cluster.isMaster) {
            console.log('combohandler master ' + process.pid + ' restarting workers...');
            for (var id in cluster.workers) {
                if (cluster.workers.hasOwnProperty(id)) {
                    process.kill(cluster.workers[id].process.pid, 'SIGUSR2');
                }
            }
        }
    },

    _signalMaster: function (signal) {
        var dir = this.options.pids;
        getMasterPid(dir, function (err, masterPid) {
            if (err) {
                console.error("Error sending signal " + signal + " to combohandler master process");
                throw err;
            } else {
                try {
                    // again, because SIGKILL is so incredibly rude,
                    // he doesn't allow us to do anything afterward
                    if ('SIGKILL' === signal) {
                        removePidFileSync(dir, 'master');
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
    },

    restart: function () {
        this._signalMaster('SIGUSR2');
    },

    status: function () {
        var dir = this.options.pids;
        getMasterPid(dir, function (err, masterPid) {
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

            getWorkerPidsSync(dir).forEach(checkStatus.bind({}, 'worker'));
        });
    },

    shutdown: function () {
        this._signalMaster('SIGTERM');
    },

    stop: function () {
        // must clean up worker pidfiles before sending SIGKILL,
        // because SIGKILL listeners basically can't do anything
        removeWorkerPidFiles(this.options.pids, function () {
            console.error('combohandler master ' + process.pid + ' stopping abruptly...');
            this._signalMaster('SIGKILL');
        });
    },

    _listen: function () {
        if (cluster.isMaster) {
            // fork
            console.log('\nForking workers from combohandler master ' + process.pid);
            // console.log(this.options);
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

// Utilities ----------------------------------------------------------------

function defaultPidsDir() {
    var prefixDir;

    // support `npm start combohandler` or `node server.js &`
    if (process.env.npm_config_prefix) {
        prefixDir = process.env.npm_config_prefix;
    }
    else {
        prefixDir = path.resolve(path.dirname(process.execPath), '..');
    }

    // ex: /usr/local/var/run/
    return path.join(prefixDir, 'var/run');
}

// Manage combohandler process master and worker pidfiles
// https://github.com/LearnBoost/cluster/blob/master/lib/plugins/pidfiles.js
function getPidFilePath(dir, name) {
    return path.join(dir, (name || 'master') + '.pid');
}

function getPidSync(dir, name) {
    return parseInt(fs.readFileSync(getPidFilePath(dir, name)), 10);
}

function getMasterPid(dir, cb) {
    fs.readFile(getPidFilePath(dir, 'master'), function (err, pid) {
        if (pid) {
            pid = parseInt(pid, 10);
        }
        if (cb) {
            cb(err, pid);
        }
    });
}

function getWorkerPidFilesSync(dir) {
    return fs.readdirSync(dir).filter(function (file) {
        return file.match(/^worker.*\.pid$/);
    });
}

function getWorkerPidsSync(dir) {
    return getWorkerPidFilesSync(dir).map(function (file) {
        return parseInt(fs.readFileSync(dir + '/' + file), 10);
    });
}

function writePidFile(dir, name, pid) {
    fs.writeFile(getPidFilePath(dir, name), pid.toString(), function (err) {
        if (err) { throw err; }
    });
}

function removePidFile(dir, name, cb) {
    fs.unlink(getPidFilePath(dir, name), function (err) {
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

function removePidFileSync(dir, name) {
    fs.unlinkSync(getPidFilePath(dir, name));
}

function removeWorkerPidFiles(dir, cb) {
    var workerPidFiles = getWorkerPidFilesSync(dir),
        remaining = workerPidFiles.length;

    workerPidFiles.forEach(function (file) {
        removePidFile(dir, file.replace(/\.pid$/, ''), function (err) {
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
