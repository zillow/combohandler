/*global describe, before, after, it */
var should = require('should');

var fs = require('fs');
var path = require('path');
var request = require('request');
var express = require('express');

var combohandler = require('../');
var server = require('../lib/server');

var PORT = 8943; // +1 from test/server.js
var BASE_URL = 'http://localhost:' + PORT;
var FIXTURES_DIR = __dirname + '/fixtures';

describe('app.use', function () {
    var app, httpServer;

    before(function (done) {
        app = express();

        app.use(express.errorHandler({
            dumpExceptions: true,
            showStack     : true
        }));

        // mounted paths
        app.use('/basic', combohandler({
            rootPath: path.join(FIXTURES_DIR, 'root')
        }));
        app.use('/rewritten', combohandler({
            basePath: '/rewritten',
            rootPath: path.resolve(FIXTURES_DIR, 'rewrite')
        }));

        // unmounted path (/)
        app.use(combohandler({
            rootPath: FIXTURES_DIR
        }));

        // don't use router
        // app.use(app.router);

        // provide baseApp
        server({}, app);

        // test backstop
        app.use(function (req, res) {
            res.send(202, 'passed');
        });

        app.use(combohandler.errorHandler);

        httpServer = app.listen(PORT, done);
    });

    after(function (done) {
        httpServer.close(done);
    });

    it("should skip middleware when request is not a GET", function (done) {
        request({
            method: 'POST',
            body: 'wut',
            uri: BASE_URL + '/?js/a.js&js/b.js'
        }, function (err, res, body) {
            should.not.exist(err);
            res.should.have.status(202);
            body.should.equal('passed');
            done();
        });
    });

    describe("with unmounted path", function () {
        it("should combine normally", responseEquals('?root/js/a.js&root/js/b.js', {
            body: 'a();\n\nb();\n'
        }));

        it("should not rewrite url()s", responseEquals('?rewrite/urls.css', {
            body: fs.readFileSync(path.join(FIXTURES_DIR, 'rewrite/urls.css'), 'utf-8')
        }));
    });

    describe("with mounted path", function () {
        describe("/basic", function () {
            it("should combine normally", responseEquals('/basic?css/a.css&css/b.css', {
                body: '.a { color: green; }\n\n.b { color: green; }\n'
            }));
        });

        describe("/rewritten", function () {
            it("should rewrite url()s", responseEquals('/rewritten?urls.css', {
                body: fs.readFileSync(path.join(FIXTURES_DIR, 'rewrite/urls.tmpl'), 'utf-8')
                            .replace(/__PATH__/g, '/rewritten/')
            }));
        });
    });

    describe('errors', function () {
    });

    // Test Utilities
    function responseEquals(url, options) {
        return function (done) {
            request(BASE_URL + path.join('/', url), function (err, res, body) {
                should.not.exist(err);
                res.should.have.status(options.code || 200);
                body.should.equal(options.body);
                done();
            });
        };
    }
});
