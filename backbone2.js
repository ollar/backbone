var Backbone = (function () {
'use strict';

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
