#!/usr/bin/env node

var combohandlerCluster = require('../lib/cluster'),
    // TODO: actual argument parsing!
    config = {
        maxAge: 31536000,
        port: 3001,
        roots: {
            //  Local "integration" test
            //
            //  Terminal:
            //      ./lib/cli.js
            //
            //  Browser:
            //      localhost:3000/test?js/a.js&js/b.js
            //      localhost:3000/test?css/a.css&css/b.css
            '/test': __dirname + '/../test/fixtures/root'
        },
        workers: 1
    };

combohandlerCluster(config).listen();
