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
        "timeout": Number,
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
        "t": ["--timeout"],
        "n": ["--workers"]
    },

    // provide exported methods on cli
    cli = module.exports = {
        clean: function (config) {
            nopt.clean(config, knownOpts);

            comboCluster.resolveRoots(config);

            return config;
        },
        parse: function () {
            var config = nopt(knownOpts, shortHands);

            // allow one string argument to stand in for boolean flag
            // or basePath config values
            config.argv.remain.some(function (arg) {
                switch (arg) {
                case 'restart':
                    return config.restart = true;
                case 'shutdown':
                    return config.shutdown = true;
                case 'status':
                    return config.status = true;
                case 'stop':
                    return config.stop = true;
                default:
                    // support basePath
                    if (path.resolve(arg)) {
                        return config.basePath = path.resolve(arg);
                    }
                    break;
                }
            });

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
