var fs   = require('fs'),
    path = require('path'),
    util = require('util'),

    // placeholder key regular expression, matches ":foo" of "/:foo/bar/"
    keyRegex = /:\w+/,

    // cache for "compiled" dynamic roots
    DYNAMIC_ROOTS = exports.DYNAMIC_ROOTS = {},

    // matches url() resource declarations in combo CSS
    urlRegex = /url\(([^\)]+)\)/g,

    // Default set of MIME types supported by the combo handler. Attempts to
    // combine one or more files with an extension not in this mapping (or not
    // in a custom mapping) will result in a 400 response.
    MIME_TYPES = exports.MIME_TYPES = {
        '.css' : 'text/css',
        '.js'  : 'application/javascript',
        '.json': 'application/json',
        '.txt' : 'text/plain',
        '.xml' : 'application/xml'
    };

// -- Exported Methods ---------------------------------------------------------
exports.combine = function (config) {
    var maxAge    = config.maxAge,
        mimeTypes = config.mimeTypes || MIME_TYPES,

        basePath  = config.basePath || '',
        rootPath  = config.rootPath,

        dynamicKey = keyRegex.test(rootPath) && rootPath.match(keyRegex)[0],
        dynamicParameter,
        rootSuffix;

        // str.match() in route config returns null if no matches or [":foo"]
        if (dynamicKey) {
            // key for the req.params must be stripped of the colon
            dynamicParameter = dynamicKey.substr(1);

            // if the placeholder is not the last token in the rootPath
            // (e.g., '/foo/:version/bar/')
            if (path.basename(rootPath).indexOf(dynamicKey) === - 1) {
                // rootSuffix must be stored for use in getDynamicRoot
                rootSuffix = rootPath.substr(rootPath.indexOf(dynamicKey) + dynamicKey.length);

                // remove key + suffix from rootPath used in initial realpathSync
                rootPath = rootPath.substring(0, rootPath.indexOf(dynamicKey));
            }
        }

        // Intentionally using the sync method because this only runs when the
        // middleware is initialized, and we want it to throw if there's an error.
        rootPath = fs.realpathSync(rootPath);

    if (!maxAge && maxAge !== null && maxAge !== 0) {
        maxAge = 31536000; // one year in seconds
    }

    function getDynamicRoot(params) {
        var dynamicPath, dynamicValue = dynamicParameter && params[dynamicParameter];

        // a dynamic placeholder has been configured
        if (dynamicValue) {
            if (DYNAMIC_ROOTS[dynamicValue]) {
                // a path has already been computed
                dynamicPath = DYNAMIC_ROOTS[dynamicValue];
            }
            else {
                // a path needs computing
                dynamicPath = path.normalize(path.join(rootPath, dynamicValue, rootSuffix));
                // cache for later re-use
                DYNAMIC_ROOTS[dynamicValue] = dynamicPath;
            }
        }
        // default to rootPath when no dynamic parameter present
        else {
            dynamicPath = rootPath;
        }

        return dynamicPath;
    }

    function absolutizeResources(absolutePath, data) {
        if (basePath && urlRegex.test(data)) {
            // subtract basePath from absolutePath to create "absolutely relative" path to dir
            var absolutelyRelativePath = path.dirname(absolutePath.replace(basePath, ''));
            /*
            Example request: /combo?3.4.1/slider-base/assets/skins/sam/slider-base.css
                basePath: /var/www
                rootPath: /var/www/static/yui/

            slider-base (default):
                url(rail-x.png)

            slider-base (modified):
                url(/static/yui/3.4.1/slider-base/assets/skins/sam/rail-x.png)
            */
            data = data.replace(urlRegex, function (match, filepath) {
                return 'url(' + path.resolve(absolutelyRelativePath, filepath) + ')';
            });
        }

        return data;
    }

    return function (req, res, next) {
        var body    = [],
            query   = parseQuery(req.url),
            pending = query.length,
            fileTypes = getFileTypes(query),
            // fileTypes array should always have one member, else error
            type    = fileTypes.length === 1 && mimeTypes[fileTypes[0]],
            isCSS   = (type === 'text/css'),
            dynamicRoot = getDynamicRoot(req.params),
            lastModified;

        function finish() {
            if (lastModified) {
                res.header('Last-Modified', lastModified.toUTCString());
            }

            // http://code.google.com/speed/page-speed/docs/caching.html
            if (maxAge !== null) {
                res.header('Cache-Control', 'public,max-age=' + maxAge);
                res.header('Expires', new Date(Date.now() + (maxAge * 1000)).toUTCString());
            }

            res.header('Content-Type', (type || 'text/plain') + ';charset=utf-8');
            res.body = body.join('\n');

            next();
        }

        if (!pending) {
            // No files requested.
            return next(new BadRequest('No files requested.'));
        }

        if (!type) {
            if (fileTypes.indexOf('') > -1) {
                // Most likely a malformed URL, which will just cause
                // an exception later. Short-cut to the inevitable conclusion.
                return next(new BadRequest('Truncated query parameters.'));
            }
            else if (fileTypes.length === 1) {
                // unmapped type found
                return next(new BadRequest('Illegal MIME type present.'));
            }
            else {
                // A request may only have one MIME type
                return next(new BadRequest('Only one MIME type allowed per request.'));
            }
        }

        query.forEach(function (relativePath, i) {
            // Skip empty parameters.
            if (!relativePath) {
                pending -= 1;
                return;
            }

            var absolutePath = path.normalize(path.join(dynamicRoot, relativePath));

            // Bubble up an error if the request attempts to traverse above the
            // root path.
            if (!absolutePath || absolutePath.indexOf(rootPath) !== 0) {
                return next(new BadRequest('File not found: ' + relativePath));
            }

            fs.stat(absolutePath, function (err, stats) {
                if (err || !stats.isFile()) {
                    return next(new BadRequest('File not found: ' + relativePath));
                }

                var mtime = new Date(stats.mtime);

                if (!lastModified || mtime > lastModified) {
                    lastModified = mtime;
                }

                fs.readFile(absolutePath, 'utf8', function (err, data) {
                    if (err) { return next(new BadRequest('Error reading file: ' + relativePath)); }

                    if (isCSS) {
                        data = absolutizeResources(absolutePath, data);
                    }

                    body[i]  = data;
                    pending -= 1;

                    if (pending === 0) {
                        finish();
                    }
                }); // fs.readFile
            }); // fs.stat
        }); // forEach
    };
};

// BadRequest is used for all filesystem-related errors, including when a
// requested file can't be found (a NotFound error wouldn't be appropriate in
// that case since the route itself exists; it's the request that's at fault).
function BadRequest(message) {
    Error.call(this);
    this.name = 'BadRequest';
    this.message = message;
    Error.captureStackTrace(this, arguments.callee);
}
util.inherits(BadRequest, Error);
exports.BadRequest = BadRequest; // exported to allow instanceof checks

// -- Private Methods ----------------------------------------------------------
function decode(string) {
    return decodeURIComponent(string).replace(/\+/g, ' ');
}

/**
Dedupes an array of strings, returning an array that's guaranteed to contain
only one copy of a given string.

This method differs from `Array.unique()` in that it's optimized for use only
with strings, whereas `unique` may be used with other types (but is slower).
Using `dedupe()` with non-string values may result in unexpected behavior.

@method dedupe
@param {String[]} array Array of strings to dedupe.
@return {Array} Deduped copy of _array_.
**/
function dedupe(array) {
    var hash    = {},
        results = [],
        hasOwn  = Object.prototype.hasOwnProperty,
        i, item, len;

    for (i = 0, len = array.length; i < len; i += 1) {
        item = array[i];

        if (!hasOwn.call(hash, item)) {
            hash[item] = 1;
            results.push(item);
        }
    }

    return results;
}

function getExtName(filename) {
    return path.extname(filename).toLowerCase();
}

function getFileTypes(files) {
    return dedupe(files.map(getExtName));
}

// Because querystring.parse() is silly and tries to be too clever.
function parseQuery(url) {
    var parsed = [],
        query  = url.split('?')[1];

    if (query) {
        query.split('&').forEach(function (item) {
            parsed.push(decode(item.split('=')[0]));
        });
    }

    return parsed;
}
