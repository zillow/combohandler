#!/usr/bin/env node

var nopt = require('nopt'),
    path = require('path'),
    comboCluster = require('../lib/cluster'),

    knownOpts = {
        "basePath": path,
        "maxAge": Number,
        "pids": path,
        "port": Number,
        "restart": Boolean,
        "rootsFile": path,
        "server": path,
        "shutdown": Boolean,
        "status": Boolean,
        "stop": Boolean,
        "workers": Number
    },
    shortHands = {
        "a": ["--server"],
        "b": ["--basePath"],
        "d": ["--pids"],
        "m": ["--maxAge"],
        "p": ["--port"],
        "f": ["--rootsFile"],
        "r": ["--restart"],
        "g": ["--shutdown"],
        "s": ["--status"],
        "S": ["--stop"],
        "n": ["--workers"]
    },

    // provide exported methods on cli
    cli = module.exports = {
        clean: function (config) {
            nopt.clean(config, knownOpts);
            return config;
        },
        parse: function () {
            var config = nopt(knownOpts, shortHands);

            if (config.argv.remain.length) {
                switch (config.argv.remain[0]) {
                case 'restart':
                    config.restart = true;
                    break;
                case 'shutdown':
                    config.shutdown = true;
                    break;
                case 'status':
                    config.status = true;
                    break;
                case 'stop':
                    config.stop = true;
                    break;
                }
            }

            comboCluster.resolveRoots(config);

            return config;
        }
    };

if (module === require.main) {
    // only parse & execute when called directly
    comboCluster(cli.parse());
}

//  Local "integration" test from root of combohandler repo
//
//  Terminal:
//      ./lib/cli.js -f ./test/root.json
//
//  Browser:
//      localhost:3000/test?js/a.js&js/b.js
//      localhost:3000/test?css/a.css&css/b.css
