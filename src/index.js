import Events from './events';
import View from './view';
import Model from './model';
import Collection from './collection';

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
}

export default Backbone;
