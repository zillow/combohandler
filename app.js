#!/usr/bin/env node

// Cluster2 docs: http://ql-io.github.com/cluster2/
var Cluster = require('cluster2');

var c = new Cluster();

c.listen(function (cb) {
    var server = require('./lib/server'),
        config = require('./config');
    cb(server(config));
});
