module.exports = {
    // The "base" of all paths resolved by the web server.
    // Used in resolving combined CSS url() resources.
    basePath: '/local/path/to/webroot',

    // Mapping of URL paths to local filesystem paths. Each URL defined here will
    // become a combo handler for files under the specified local directory.
    //
    // You can then make combo-handled requests to these paths, like:
    //
    //   http://example.com/yui2?build/yahoo/yahoo-min.js&build/yuiloader/yuiloader-min.js
    //   http://example.com/yui3?build/yui/yui-min.js&build/loader/loader-min.js
    //
    roots: {
        '/yui2': '/local/path/to/yui2',
        '/yui3': '/local/path/to/yui3'
    },

    // Maximum age in seconds to send in the `Cache-Control` and `Expires`
    // response headers. Set this to `0` to cause immediate expiration, or
    // `null` to prevent the `Cache-Control` and `Expires` headers from being
    // set.
    //
    // The default value is 31536000 seconds, or 1 year.
    maxAge: 31536000
};
