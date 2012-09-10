var express = require('express'),
    combo   = require('./combohandler');

module.exports = function (config, baseApp) {
    var app   = baseApp || express(),
        roots = (config && config.roots) || {},
        route;

    if (!baseApp) {
        app.configure('development', function () {
            app.use(express.logger());
            app.use(express.errorHandler({
                dumpExceptions: true,
                showStack     : true
            }));
        });

        app.configure('test', function () {
            app.use(express.errorHandler({
                dumpExceptions: true,
                showStack     : true
            }));
        });

        app.configure('production', function () {
            app.use(express.errorHandler());
        });

        app.use(app.router);

        app.use(function (err, req, res, next) {
            if (err instanceof combo.BadRequest) {
                res.charset = 'utf-8';
                res.type('text/plain');
                res.send(err.status, 'Bad request. ' + err.message);
            } else {
                next(err);
            }
        });
    }

    for (route in roots) {
        app.get(route, combo.combine({rootPath: roots[route]}), function (req, res) {
            res.send(200, res.body);
        });
    }

    return app;
};
