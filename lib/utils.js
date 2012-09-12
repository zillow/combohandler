/**
Utilities

**/

// mix & merge lifted from yui-base, simplified
var mix = exports.mix = function (receiver, supplier, overwrite) {
    var key;

    if (!receiver || !supplier) {
        return receiver || {};
    }

    for (key in supplier) {
        if (supplier.hasOwnProperty(key)) {
            if (overwrite || !receiver.hasOwnProperty(key)) {
                receiver[key] = supplier[key];
            }
        }
    }

    return receiver;
};

exports.merge = function () {
    var args   = arguments,
        i      = 0,
        len    = args.length,
        result = {};

    for (; i < len; i += 1) {
        mix(result, args[i], true);
    }

    return result;
};
