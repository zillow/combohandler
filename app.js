#!/usr/bin/env node

var cluster = require('cluster');

if (cluster.isMaster) {
    var fs = require('fs'),
        path = require('path'),

        // support `npm start combohandler` or `node server.js &`
        prefixDir = process.env.npm_config_prefix || path.resolve(path.dirname(process.execPath), '..'),
        runDir = prefixDir + '/var/run',

        args = process.argv.slice(2);

    // CLI argument handling
    // https://github.com/LearnBoost/cluster/blob/master/lib/plugins/cli.js
    if (args.length) {
        switch (args[0]) {
        case 'stop':
            // must clean up worker pidfiles before sending SIGKILL,
            // because SIGKILL listeners basically can't do anything
            removeWorkerPidFiles(function () {
                console.error('combohandler master ' + process.pid + ' stopping abruptly...');
                sendSignalToMaster('SIGKILL');
            });
            break;
        case 'shutdown':
            sendSignalToMaster('SIGTERM');
            break;
        }
    }
    else {
        // Master P(rocess) Machinations
        var numCPUs = require('os').cpus().length,
            timeouts = [],
            flameouts = 0;
            // TODO: configurable numCPUs, flameouts

        // this doesn't work in OS X, but whatever
        process.title = 'combohandler master';

        // ensure runDir exists before writing the pidfile
        if (!fs.existsSync(runDir)) {
            require('mkdirp').sync(runDir);
        }

        writePidFile('master', process.pid);

        process.on('SIGINT',  gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGUSR2', restartWorkers);

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

        console.log('\nForking workers from combohandler master ' + process.pid);
        while (numCPUs--) {
            cluster.fork();
        }
    }
}
else {
    var server = require('./lib/server'),
        config = require('./config');

    server(config).listen(config.port || 3000);
}

// Utilities ----------------------------------------------------------------

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
