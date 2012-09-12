#!/usr/bin/env node

var nopt = require('nopt'),
    path = require('path'),
    knownOpts = {
        "basePath": path,
        "dir": path,
        "maxAge": Number,
        "port": Number,
        "restart": Boolean,
        "rootsFile": path,
        "server": path,
        "shutdown": Boolean,
        "status": Boolean,
        "stop": Boolean,
        "workers": Number
    },
    shorthands = {
        "a": ["--server"],
        "b": ["--basePath"],
        "d": ["--dir"],
        "m": ["--maxAge"],
        "p": ["--port"],
        "f": ["--rootsFile"],
        "r": ["--restart"],
        "g": ["--shutdown"],
        "s": ["--status"],
        "S": ["--stop"],
        "n": ["--workers"]
    },
    config = nopt(knownOpts, shorthands);

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

require('../lib/cluster')(config);
