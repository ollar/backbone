var Backbone = (function () {
'use strict';

// A module that can be mixed in to *any object* in order to provide it with
// a custom event channel. You may bind a callback to an event with `on` or
// remove with `off`; `trigger`-ing an event fires all callbacks in
// succession.
//
//     var object = {};
//     _.extend(object, Backbone.Events);
//     object.on('expand', function(){ alert('expanded'); });
//     object.trigger('expand');

// Regular expression used to split event strings.


const Events = {

};

const View = {

};

const Model = {

};

const Collection = {};

var previousBackbone = root.Backbone;


const Backbone = {
    VERSION: '1.3.3',

    // $: $,
    // _: _

    noConflict() {
      root.Backbone = previousBackbone;
      return this;
    },

    emulateHTTP: false,
    emulateJSON: false,

    Events,
    View,
    Model,
    Collection,
};

return Backbone;

}());
//# sourceMappingURL=backbone2.js.map
