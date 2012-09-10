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
            sendSignalToMaster('SIGKILL');
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

        writePidFile(process.pid);

        process.on('SIGINT',  onSignal.bind(cluster, 'SIGINT' ));
        process.on('SIGKILL', onSignal.bind(cluster, 'SIGKILL'));
        process.on('SIGTERM', onSignal.bind(cluster, 'SIGTERM'));
        process.on('SIGUSR2', onSignal.bind(cluster, 'SIGUSR2'));

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
        });

        cluster.on('exit', function (worker, code, signal) {
            clearTimeout(timeouts[worker.id]);

            if (signal) {
                console.error('Worker ' + worker.id + ' received signal ' + signal);
            }

            if (code) {
                console.error('Worker ' + worker.id + ' exited with code ' + code);
                if (++flameouts > 20) {
                    console.error("Too many errors during startup, bailing!");
                    process.exit(1);
                }
            }

            if (worker.suicide) {
                console.log('Worker ' + worker.id + ' exited cleanly.');
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

// Simple function to call a function on each worker
function eachWorker(cb) {
    // Go through all workers
    for (var id in cluster.workers) {
        if (cluster.workers.hasOwnProperty(id)) {
            cb(cluster.workers[id]);
        }
    }
}


// Manage master process combohandler.pid file
// https://github.com/LearnBoost/cluster/blob/master/lib/plugins/pidfiles.js
function getPidFilePath() {
    return path.join(runDir, 'combohandler.pid');
}

function getPidSync() {
    return parseInt(fs.readFileSync(getPidFilePath()), 10);
}

function getPid(cb) {
    fs.readFile(getPidFilePath(), function (err, data) {
        if (data) {
            data = parseInt(data, 10);
        }
        if (cb) {
            cb(err, data);
        }
    });
}

function writePidFile(pid) {
    fs.writeFile(getPidFilePath(), pid.toString(), function (err) {
        if (err) { throw err; }
    });
}

function removePidFile() {
    fs.unlink(getPidFilePath(), function (err) {
        if (err) { throw err; }
    });
}


function sendSignalToMaster(signal) {
    getPid(function (err, pid) {
        if (err) {
            console.error(err);
        } else {
            process.kill(pid, signal);
        }
    });
    // process.kill(getPidSync(), signal);
}

// Process Signal Events
// http://nodejs.org/api/process.html#process_signal_events
function onSignal(signal) {
    // http://en.wikipedia.org/wiki/Unix_signal#List_of_signals
    switch (signal) {
    case 'SIGINT' : // graceful (ctrl+C)
        cluster.disconnect(removePidFile);
        break;
    case 'SIGKILL': // brutal
        removePidFile();
        cluster.destroy();
        break;
    case 'SIGTERM': // graceful
        cluster.disconnect(removePidFile);
        break;
    case 'SIGUSR2': // reload config, rotate logs
        console.log('combohandler master ' + process.pid + ' received SIGUSR2');
        eachWorker(function (worker) {
            process.kill(worker.process.pid, 'SIGUSR2');
        });
        break;
    }
}
