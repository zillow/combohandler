#!/usr/bin/env node

// Cluster2 docs: http://ql-io.github.com/cluster2/
var Cluster = require('cluster2'),
    args = process.argv.slice(2),

    c = new Cluster({
        stop    : args.indexOf("stop") > -1,
        shutdown: args.indexOf("shutdown") > -1
    });

c.listen(function (cb) {
    var server = require('./lib/server'),
        config = require('./config');
    cb(server(config));
});
