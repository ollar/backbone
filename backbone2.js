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
const eventSplitter = /\s+/;

// A private global variable to share between listeners and listenees.
let _listening;

// Iterates over the standard `event, callback` (as well as the fancy multiple
// space-separated events `"change blur", callback` and jQuery-style event
// maps `{event: callback}`).
function eventsApi(iteratee, events, name, callback, opts) {
  var i = 0, names;
  if (name && typeof name === 'object') {
    // Handle event maps.
    if (callback !== void 0 && 'context' in opts && opts.context === void 0) opts.context = callback;
    for (names = _.keys(name); i < names.length ; i++) {
      events = eventsApi(iteratee, events, names[i], name[names[i]], opts);
    }
  } else if (name && eventSplitter.test(name)) {
    // Handle space-separated event names by delegating them individually.
    for (names = name.split(eventSplitter); i < names.length; i++) {
      events = iteratee(events, names[i], callback, opts);
    }
  } else {
    // Finally, standard events.
    events = iteratee(events, name, callback, opts);
  }
  return events;
}

// The reducing API that adds a callback to the `events` object.
function onApi(events, name, callback, options) {
    if (callback) {
      var handlers = events[name] || (events[name] = []);
      var context = options.context, ctx = options.ctx, listening = options.listening;
      if (listening) listening.count++;

      handlers.push({callback: callback, context: context, ctx: context || ctx, listening: listening});
    }
    return events;
  }

// An try-catch guarded #on function, to prevent poisoning the global
// `_listening` variable.
function tryCatchOn(obj, name, callback, context) {
  try {
    obj.on(name, callback, context);
  } catch (e) {
    return e;
  }
}

// The reducing API that removes a callback from the `events` object.
function offApi(events, name, callback, options) {
  if (!events) return;

  var context = options.context, listeners = options.listeners;
  var i = 0, names;

  // Delete all event listeners and "drop" events.
  if (!name && !context && !callback) {
    for (names = _.keys(listeners); i < names.length; i++) {
      listeners[names[i]].cleanup();
    }
    return;
  }

  names = name ? [name] : _.keys(events);
  for (; i < names.length; i++) {
    name = names[i];
    var handlers = events[name];

    // Bail out if there are no events stored.
    if (!handlers) break;

    // Find any remaining events.
    var remaining = [];
    for (var j = 0; j < handlers.length; j++) {
      var handler = handlers[j];
      if (
        callback && callback !== handler.callback &&
          callback !== handler.callback._callback ||
            context && context !== handler.context
      ) {
        remaining.push(handler);
      } else {
        var listening = handler.listening;
        if (listening) listening.off(name, callback);
      }
    }

    // Replace events if there are any remaining.  Otherwise, clean up.
    if (remaining.length) {
      events[name] = remaining;
    } else {
      delete events[name];
    }
  }

  return events;
}

// Reduces the event callbacks into a map of `{event: onceWrapper}`.
// `offer` unbinds the `onceWrapper` after it has been called.
function onceMap(map, name, callback, offer) {
  if (callback) {
    var once = map[name] = _.once(function() {
      offer(name, once);
      callback.apply(this, arguments);
    });
    once._callback = callback;
  }
  return map;
}

// Handles triggering the appropriate event callbacks.
function triggerApi(objEvents, name, callback, args) {
  if (objEvents) {
    var events = objEvents[name];
    var allEvents = objEvents.all;
    if (events && allEvents) allEvents = allEvents.slice();
    if (events) triggerEvents(events, args);
    if (allEvents) triggerEvents(allEvents, [name].concat(args));
  }
  return objEvents;
}

// A difficult-to-believe, but optimized internal dispatch function for
// triggering events. Tries to keep the usual cases speedy (most internal
// Backbone events have 3 arguments).
function triggerEvents(events, args) {
  var ev, i = -1, l = events.length, a1 = args[0], a2 = args[1], a3 = args[2];
  switch (args.length) {
    case 0: while (++i < l) (ev = events[i]).callback.call(ev.ctx); return;
    case 1: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1); return;
    case 2: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2); return;
    case 3: while (++i < l) (ev = events[i]).callback.call(ev.ctx, a1, a2, a3); return;
    default: while (++i < l) (ev = events[i]).callback.apply(ev.ctx, args); return;
  }
}


// A listening class that tracks and cleans up memory bindings
// when all callbacks have been offed.
class Listening {
  constructor(listener, obj) {
    this.id = listener._listenId;
    this.listener = listener;
    this.obj = obj;
    this.interop = true;
    this.count = 0;
    this._events = void 0;
    this.on = Events.on;
  }


  // Offs a callback (or several).
  // Uses an optimized counter if the listenee uses Backbone.Events.
  // Otherwise, falls back to manual tracking to support events
  // library interop.
  off(name, callback) {
    var cleanup;
    if (this.interop) {
      this._events = eventsApi(offApi, this._events, name, callback, {
        context: void 0,
        listeners: void 0
      });
      cleanup = !this._events;
    } else {
      this.count--;
      cleanup = this.count === 0;
    }
    if (cleanup) this.cleanup();
  }

  // Cleans up memory bindings between the listener and the listenee.
  cleanup() {
    delete this.listener._listeningTo[this.obj._listenId];
    if (!this.interop) delete this.obj._listeners[this.id];
  };
}


const Events = {
  // Bind an event to a `callback` function. Passing `"all"` will bind
  // the callback to all events fired.
  on(name, callback, context) {
    this._events = eventsApi(onApi, this._events || {}, name, callback, {
      context: context,
      ctx: this,
      listening: _listening
    });

    if (_listening) {
      var listeners = this._listeners || (this._listeners = {});
      listeners[_listening.id] = _listening;
      // Allow the listening to use a counter, instead of tracking
      // callbacks for library interop
      _listening.interop = false;
    }

    return this;
  },

  // Inversion-of-control versions of `on`. Tell *this* object to listen to
  // an event in another object... keeping track of what it's listening to
  // for easier unbinding later.
  listenTo(obj, name, callback) {
    if (!obj) return this;
    var id = obj._listenId || (obj._listenId = _.uniqueId('l'));
    var listeningTo = this._listeningTo || (this._listeningTo = {});
    var listening = _listening = listeningTo[id];

    // This object is not listening to any other events on `obj` yet.
    // Setup the necessary references to track the listening callbacks.
    if (!listening) {
      this._listenId || (this._listenId = _.uniqueId('l'));
      listening = _listening = listeningTo[id] = new Listening(this, obj);
    }

    // Bind callbacks on obj.
    var error = tryCatchOn(obj, name, callback, this);
    _listening = void 0;

    if (error) throw error;
    // If the target obj is not Backbone.Events, track events manually.
    if (listening.interop) listening.on(name, callback);

    return this;
  },

  // Remove one or many callbacks. If `context` is null, removes all
  // callbacks with that function. If `callback` is null, removes all
  // callbacks for the event. If `name` is null, removes all bound
  // callbacks for all events.
  off(name, callback, context) {
    if (!this._events) return this;
    this._events = eventsApi(offApi, this._events, name, callback, {
      context: context,
      listeners: this._listeners
    });

    return this;
  },

  // Tell this object to stop listening to either specific events ... or
  // to every object it's currently listening to.
  stopListening(obj, name, callback) {
    var listeningTo = this._listeningTo;
    if (!listeningTo) return this;

    var ids = obj ? [obj._listenId] : _.keys(listeningTo);
    for (var i = 0; i < ids.length; i++) {
      var listening = listeningTo[ids[i]];

      // If listening doesn't exist, this object is not currently
      // listening to obj. Break out early.
      if (!listening) break;

      listening.obj.off(name, callback, this);
      if (listening.interop) listening.off(name, callback);
    }
    if (_.isEmpty(listeningTo)) this._listeningTo = void 0;

    return this;
  },

  // Bind an event to only be triggered a single time. After the first time
  // the callback is invoked, its listener will be removed. If multiple events
  // are passed in using the space-separated syntax, the handler will fire
  // once for each event, not once for a combination of all events.
  once(name, callback, context) {
    // Map the event into a `{event: once}` object.
    var events = eventsApi(onceMap, {}, name, callback, _.bind(this.off, this));
    if (typeof name === 'string' && context == null) callback = void 0;
    return this.on(events, callback, context);
  },

  // Inversion-of-control versions of `once`.
  listenToOnce(obj, name, callback) {
    // Map the event into a `{event: once}` object.
    var events = eventsApi(onceMap, {}, name, callback, _.bind(this.stopListening, this, obj));
    return this.listenTo(obj, events);
  },

  // Trigger one or many events, firing all bound callbacks. Callbacks are
  // passed the same arguments as `trigger` is, apart from the event name
  // (unless you're listening on `"all"`, which will cause your callback to
  // receive the true name of the event as the first argument).
  trigger(name) {
    if (!this._events) return this;

    var length = Math.max(0, arguments.length - 1);
    var args = Array(length);
    for (var i = 0; i < length; i++) args[i] = arguments[i + 1];

    eventsApi(triggerApi, this._events, name, void 0, args);
    return this;
  },
};

// Aliases for backwards compatibility.
Events.bind   = Events.on;
Events.unbind = Events.off;

const View = {

};

// Backbone.Model
// --------------

// Backbone **Models** are the basic data object in the framework --
// frequently representing a row in a table in a database on your server.
// A discrete chunk of data and a bunch of useful, related methods for
// performing computations and transformations on that data.

// Create a new model with the specified attributes. A client id (`cid`)
// is automatically generated and assigned for you.



class Model$1{
  constructor() {
    var attrs = attributes || {};
    options || (options = {});
    this.preinitialize.apply(this, arguments);
    this.cid = _.uniqueId(this.cidPrefix);
    this.attributes = {};
    if (options.collection) this.collection = options.collection;
    if (options.parse) attrs = this.parse(attrs, options) || {};
    var defaults = _.result(this, 'defaults');
    attrs = _.defaults(_.extend({}, defaults, attrs), defaults);
    this.set(attrs, options);
    this.changed = {};
    this.initialize.apply(this, arguments);

    // A hash of attributes whose current and previous value differ.
    this.changed = null;

    // The value returned during the last failed validation.
    this.validationError = null;

    // The default name for the JSON `id` attribute is `"id"`. MongoDB and
    // CouchDB users may want to set this to `"_id"`.
    this.idAttribute = 'id';

    // The prefix is used to create the client id which is used to identify models locally.
    // You may want to override this if you're experiencing name clashes with model ids.
    this.cidPrefix = 'c';
  }

  // preinitialize is an empty function by default. You can override it with a function
  // or object.  preinitialize will run before any instantiation logic is run in the Model.
  preinitialize() {}

  // Initialize is an empty function by default. Override it with your own
  // initialization logic.
  initialize() {}

  // Return a copy of the model's `attributes` object.
  toJSON(options) {
    return _.clone(this.attributes);
  }

  // Proxy `Backbone.sync` by default -- but override this if you need
  // custom syncing semantics for *this* particular model.
  sync() {
    return Backbone.sync.apply(this, arguments);
  }

  // Get the value of an attribute.
  get(attr) {
    return this.attributes[attr];
  }

  // Get the HTML-escaped value of an attribute.
  escape(attr) {
    return _.escape(this.get(attr));
  }

  // Returns `true` if the attribute contains a value that is not null
  // or undefined.
  has(attr) {
    return this.get(attr) != null;
  }

  // Special-cased proxy to underscore's `_.matches` method.
  matches(attrs) {
    return !!_.iteratee(attrs, this)(this.attributes);
  }

  // Set a hash of model attributes on the object, firing `"change"`. This is
  // the core primitive operation of a model, updating the data and notifying
  // anyone who needs to know about the change in state. The heart of the beast.
  set(key, val, options) {
    if (key == null) return this;

    // Handle both `"key", value` and `{key: value}` -style arguments.
    var attrs;
    if (typeof key === 'object') {
      attrs = key;
      options = val;
    } else {
      (attrs = {})[key] = val;
    }

    options || (options = {});

    // Run validation.
    if (!this._validate(attrs, options)) return false;

    // Extract attributes and options.
    var unset      = options.unset;
    var silent     = options.silent;
    var changes    = [];
    var changing   = this._changing;
    this._changing = true;

    if (!changing) {
      this._previousAttributes = _.clone(this.attributes);
      this.changed = {};
    }

    var current = this.attributes;
    var changed = this.changed;
    var prev    = this._previousAttributes;

    // For each `set` attribute, update or delete the current value.
    for (var attr in attrs) {
      val = attrs[attr];
      if (!_.isEqual(current[attr], val)) changes.push(attr);
      if (!_.isEqual(prev[attr], val)) {
        changed[attr] = val;
      } else {
        delete changed[attr];
      }
      unset ? delete current[attr] : current[attr] = val;
    }

    // Update the `id`.
    if (this.idAttribute in attrs) this.id = this.get(this.idAttribute);

    // Trigger all relevant attribute changes.
    if (!silent) {
      if (changes.length) this._pending = options;
      for (var i = 0; i < changes.length; i++) {
        this.trigger('change:' + changes[i], this, current[changes[i]], options);
      }
    }

    // You might be wondering why there's a `while` loop here. Changes can
    // be recursively nested within `"change"` events.
    if (changing) return this;
    if (!silent) {
      while (this._pending) {
        options = this._pending;
        this._pending = false;
        this.trigger('change', this, options);
      }
    }
    this._pending = false;
    this._changing = false;
    return this;
  }

  // Remove an attribute from the model, firing `"change"`. `unset` is a noop
  // if the attribute doesn't exist.
  unset(attr, options) {
    return this.set(attr, void 0, _.extend({}, options, {unset: true}));
  }

  // Clear all attributes on the model, firing `"change"`.
  clear(options) {
    var attrs = {};
    for (var key in this.attributes) attrs[key] = void 0;
    return this.set(attrs, _.extend({}, options, {unset: true}));
  }

  // Determine if the model has changed since the last `"change"` event.
  // If you specify an attribute name, determine if that attribute has changed.
  hasChanged(attr) {
    if (attr == null) return !_.isEmpty(this.changed);
    return _.has(this.changed, attr);
  }

  // Return an object containing all the attributes that have changed, or
  // false if there are no changed attributes. Useful for determining what
  // parts of a view need to be updated and/or what attributes need to be
  // persisted to the server. Unset attributes will be set to undefined.
  // You can also pass an attributes object to diff against the model,
  // determining if there *would be* a change.
  changedAttributes(diff) {
    if (!diff) return this.hasChanged() ? _.clone(this.changed) : false;
    var old = this._changing ? this._previousAttributes : this.attributes;
    var changed = {};
    var hasChanged;
    for (var attr in diff) {
      var val = diff[attr];
      if (_.isEqual(old[attr], val)) continue;
      changed[attr] = val;
      hasChanged = true;
    }
    return hasChanged ? changed : false;
  }

  // Get the previous value of an attribute, recorded at the time the last
  // `"change"` event was fired.
  previous(attr) {
    if (attr == null || !this._previousAttributes) return null;
    return this._previousAttributes[attr];
  }

  // Get all of the attributes of the model at the time of the previous
  // `"change"` event.
  previousAttributes() {
    return _.clone(this._previousAttributes);
  }

  // Fetch the model from the server, merging the response with the model's
  // local attributes. Any changed attributes will trigger a "change" event.
  fetch(options) {
    options = _.extend({parse: true}, options);
    var model = this;
    var success = options.success;
    options.success = function(resp) {
      var serverAttrs = options.parse ? model.parse(resp, options) : resp;
      if (!model.set(serverAttrs, options)) return false;
      if (success) success.call(options.context, model, resp, options);
      model.trigger('sync', model, resp, options);
    };
    wrapError(this, options);
    return this.sync('read', this, options);
  }

  // Set a hash of model attributes, and sync the model to the server.
  // If the server returns an attributes hash that differs, the model's
  // state will be `set` again.
  save(key, val, options) {
    // Handle both `"key", value` and `{key: value}` -style arguments.
    var attrs;
    if (key == null || typeof key === 'object') {
      attrs = key;
      options = val;
    } else {
      (attrs = {})[key] = val;
    }

    options = _.extend({validate: true, parse: true}, options);
    var wait = options.wait;

    // If we're not waiting and attributes exist, save acts as
    // `set(attr).save(null, opts)` with validation. Otherwise, check if
    // the model will be valid when the attributes, if any, are set.
    if (attrs && !wait) {
      if (!this.set(attrs, options)) return false;
    } else if (!this._validate(attrs, options)) {
      return false;
    }

    // After a successful server-side save, the client is (optionally)
    // updated with the server-side state.
    var model = this;
    var success = options.success;
    var attributes = this.attributes;
    options.success = function(resp) {
      // Ensure attributes are restored during synchronous saves.
      model.attributes = attributes;
      var serverAttrs = options.parse ? model.parse(resp, options) : resp;
      if (wait) serverAttrs = _.extend({}, attrs, serverAttrs);
      if (serverAttrs && !model.set(serverAttrs, options)) return false;
      if (success) success.call(options.context, model, resp, options);
      model.trigger('sync', model, resp, options);
    };
    wrapError(this, options);

    // Set temporary attributes if `{wait: true}` to properly find new ids.
    if (attrs && wait) this.attributes = _.extend({}, attributes, attrs);

    var method = this.isNew() ? 'create' : (options.patch ? 'patch' : 'update');
    if (method === 'patch' && !options.attrs) options.attrs = attrs;
    var xhr = this.sync(method, this, options);

    // Restore attributes.
    this.attributes = attributes;

    return xhr;
  }

  // Destroy this model on the server if it was already persisted.
  // Optimistically removes the model from its collection, if it has one.
  // If `wait: true` is passed, waits for the server to respond before removal.
  destroy(options) {
    options = options ? _.clone(options) : {};
    var model = this;
    var success = options.success;
    var wait = options.wait;

    var destroy = function() {
      model.stopListening();
      model.trigger('destroy', model, model.collection, options);
    };

    options.success = function(resp) {
      if (wait) destroy();
      if (success) success.call(options.context, model, resp, options);
      if (!model.isNew()) model.trigger('sync', model, resp, options);
    };

    var xhr = false;
    if (this.isNew()) {
      _.defer(options.success);
    } else {
      wrapError(this, options);
      xhr = this.sync('delete', this, options);
    }
    if (!wait) destroy();
    return xhr;
  }

  // Default URL for the model's representation on the server -- if you're
  // using Backbone's restful methods, override this to change the endpoint
  // that will be called.
  url() {
    var base =
      _.result(this, 'urlRoot') ||
      _.result(this.collection, 'url') ||
      urlError();
    if (this.isNew()) return base;
    var id = this.get(this.idAttribute);
    return base.replace(/[^\/]$/, '$&/') + encodeURIComponent(id);
  }

  // **parse** converts a response into the hash of attributes to be `set` on
  // the model. The default implementation is just to pass the response along.
  parse(resp, options) {
    return resp;
  }

  // Create a new model with identical attributes to this one.
  clone() {
    return new this.constructor(this.attributes);
  }

  // A model is new if it has never been saved to the server, and lacks an id.
  isNew() {
    return !this.has(this.idAttribute);
  }

  // Check if the model is currently in a valid state.
  isValid(options) {
    return this._validate({}, _.extend({}, options, {validate: true}));
  }

  // Run validation against the next complete set of model attributes,
  // returning `true` if all is well. Otherwise, fire an `"invalid"` event.
  _validate(attrs, options) {
    if (!options.validate || !this.validate) return true;
    attrs = _.extend({}, this.attributes, attrs);
    var error = this.validationError = this.validate(attrs, options) || null;
    if (!error) return true;
    this.trigger('invalid', this, error, _.extend(options, {validationError: error}));
    return false;
  }
}

// Backbone.Collection
  // -------------------

  // If models tend to represent a single row of data, a Backbone Collection is
  // more analogous to a table full of data ... or a small slice or page of that
  // table, or a collection of rows that belong together for a particular reason
  // -- all of the messages in this particular folder, all of the documents
  // belonging to this particular author, and so on. Collections maintain
  // indexes of their models, both in order, and for lookup by `id`.

  // Create a new **Collection**, perhaps to contain a specific type of `model`.
  // If a `comparator` is specified, the Collection will maintain
  // its models in sort order, as they're added and removed.

// Defining an @@iterator method implements JavaScript's Iterable protocol.
// In modern ES2015 browsers, this value is found at Symbol.iterator.
/* global Symbol */
var $$iterator = typeof Symbol === 'function' && Symbol.iterator;
if ($$iterator) {
  Collection.prototype[$$iterator] = Collection.prototype.values;
}

// CollectionIterator
// ------------------

// A CollectionIterator implements JavaScript's Iterator protocol, allowing the
// use of `for of` loops in modern browsers and interoperation between
// Backbone.Collection and other JavaScript functions and third-party libraries
// which can operate on Iterables.
function CollectionIterator(collection, kind) {
  this._collection = collection;
  this._kind = kind;
  this._index = 0;
}

// This "enum" defines the three possible kinds of values which can be emitted
// by a CollectionIterator that correspond to the values(), keys() and entries()
// methods on Collection, respectively.
var ITERATOR_VALUES = 1;
var ITERATOR_KEYS = 2;
var ITERATOR_KEYSVALUES = 3;

// All Iterators should themselves be Iterable.
if ($$iterator) {
  CollectionIterator.prototype[$$iterator] = function() {
    return this;
  };
}

CollectionIterator.prototype.next = function() {
  if (this._collection) {

    // Only continue iterating if the iterated collection is long enough.
    if (this._index < this._collection.length) {
      var model = this._collection.at(this._index);
      this._index++;

      // Construct a value depending on what kind of values should be iterated.
      var value;
      if (this._kind === ITERATOR_VALUES) {
        value = model;
      } else {
        var id = this._collection.modelId(model.attributes);
        if (this._kind === ITERATOR_KEYS) {
          value = id;
        } else { // ITERATOR_KEYSVALUES
          value = [id, model];
        }
      }
      return {value: value, done: false};
    }

    // Once exhausted, remove the reference to the collection so future
    // calls to the next method always return done.
    this._collection = void 0;
  }

  return {value: void 0, done: true};
};

class Collection{
  constructor(models, options) {
    options || (options = {});
    this.preinitialize.apply(this, arguments);
    if (options.model) this.model = options.model;
    if (options.comparator !== void 0) this.comparator = options.comparator;
    this._reset();
    this.initialize.apply(this, arguments);
    if (models) this.reset(models, _.extend({silent: true}, options));

    this.setOptions = {add: true, remove: true, merge: true};
    this.addOptions = {add: true, remove: false};

    // The default model for a collection is just a **Backbone.Model**.
    // This should be overridden in most cases.
    this.model = Model;
  }

  // preinitialize is an empty function by default. You can override it with a function
  // or object.  preinitialize will run before any instantiation logic is run in the Collection.
  preinitialize() {}

  // Initialize is an empty function by default. Override it with your own
  // initialization logic.
  initialize() {}

  // The JSON representation of a Collection is an array of the
  // models' attributes.
  toJSON(options) {
    return this.map(function(model) { return model.toJSON(options); });
  }

  // Proxy `Backbone.sync` by default.
  sync() {
    return Backbone.sync.apply(this, arguments);
  }

  // Add a model, or list of models to the set. `models` may be Backbone
  // Models or raw JavaScript objects to be converted to Models, or any
  // combination of the two.
  add(models, options) {
    return this.set(models, _.extend({merge: false}, options, addOptions));
  }

  // Remove a model, or a list of models from the set.
  remove(models, options) {
    options = _.extend({}, options);
    var singular = !_.isArray(models);
    models = singular ? [models] : models.slice();
    var removed = this._removeModels(models, options);
    if (!options.silent && removed.length) {
      options.changes = {added: [], merged: [], removed: removed};
      this.trigger('update', this, options);
    }
    return singular ? removed[0] : removed;
  }

  // Update a collection by `set`-ing a new list of models, adding new ones,
  // removing models that are no longer present, and merging models that
  // already exist in the collection, as necessary. Similar to **Model#set**,
  // the core operation for updating the data contained by the collection.
  set(models, options) {
    if (models == null) return;

    options = _.extend({}, setOptions, options);
    if (options.parse && !this._isModel(models)) {
      models = this.parse(models, options) || [];
    }

    var singular = !_.isArray(models);
    models = singular ? [models] : models.slice();

    var at = options.at;
    if (at != null) at = +at;
    if (at > this.length) at = this.length;
    if (at < 0) at += this.length + 1;

    var set = [];
    var toAdd = [];
    var toMerge = [];
    var toRemove = [];
    var modelMap = {};

    var add = options.add;
    var merge = options.merge;
    var remove = options.remove;

    var sort = false;
    var sortable = this.comparator && at == null && options.sort !== false;
    var sortAttr = _.isString(this.comparator) ? this.comparator : null;

    // Turn bare objects into model references, and prevent invalid models
    // from being added.
    var model, i;
    for (i = 0; i < models.length; i++) {
      model = models[i];

      // If a duplicate is found, prevent it from being added and
      // optionally merge it into the existing model.
      var existing = this.get(model);
      if (existing) {
        if (merge && model !== existing) {
          var attrs = this._isModel(model) ? model.attributes : model;
          if (options.parse) attrs = existing.parse(attrs, options);
          existing.set(attrs, options);
          toMerge.push(existing);
          if (sortable && !sort) sort = existing.hasChanged(sortAttr);
        }
        if (!modelMap[existing.cid]) {
          modelMap[existing.cid] = true;
          set.push(existing);
        }
        models[i] = existing;

      // If this is a new, valid model, push it to the `toAdd` list.
      } else if (add) {
        model = models[i] = this._prepareModel(model, options);
        if (model) {
          toAdd.push(model);
          this._addReference(model, options);
          modelMap[model.cid] = true;
          set.push(model);
        }
      }
    }

    // Remove stale models.
    if (remove) {
      for (i = 0; i < this.length; i++) {
        model = this.models[i];
        if (!modelMap[model.cid]) toRemove.push(model);
      }
      if (toRemove.length) this._removeModels(toRemove, options);
    }

    // See if sorting is needed, update `length` and splice in new models.
    var orderChanged = false;
    var replace = !sortable && add && remove;
    if (set.length && replace) {
      orderChanged = this.length !== set.length || _.some(this.models, function(m, index) {
        return m !== set[index];
      });
      this.models.length = 0;
      splice(this.models, set, 0);
      this.length = this.models.length;
    } else if (toAdd.length) {
      if (sortable) sort = true;
      splice(this.models, toAdd, at == null ? this.length : at);
      this.length = this.models.length;
    }

    // Silently sort the collection if appropriate.
    if (sort) this.sort({silent: true});

    // Unless silenced, it's time to fire all appropriate add/sort/update events.
    if (!options.silent) {
      for (i = 0; i < toAdd.length; i++) {
        if (at != null) options.index = at + i;
        model = toAdd[i];
        model.trigger('add', model, this, options);
      }
      if (sort || orderChanged) this.trigger('sort', this, options);
      if (toAdd.length || toRemove.length || toMerge.length) {
        options.changes = {
          added: toAdd,
          removed: toRemove,
          merged: toMerge
        };
        this.trigger('update', this, options);
      }
    }

    // Return the added (or merged) model (or models).
    return singular ? models[0] : models;
  }

  // When you have more items than you want to add or remove individually,
  // you can reset the entire set with a new list of models, without firing
  // any granular `add` or `remove` events. Fires `reset` when finished.
  // Useful for bulk operations and optimizations.
  reset(models, options) {
    options = options ? _.clone(options) : {};
    for (var i = 0; i < this.models.length; i++) {
      this._removeReference(this.models[i], options);
    }
    options.previousModels = this.models;
    this._reset();
    models = this.add(models, _.extend({silent: true}, options));
    if (!options.silent) this.trigger('reset', this, options);
    return models;
  }

  // Add a model to the end of the collection.
  push(model, options) {
    return this.add(model, _.extend({at: this.length}, options));
  }

  // Remove a model from the end of the collection.
  pop(options) {
    var model = this.at(this.length - 1);
    return this.remove(model, options);
  }

  // Add a model to the beginning of the collection.
  unshift(model, options) {
    return this.add(model, _.extend({at: 0}, options));
  }

  // Remove a model from the beginning of the collection.
  shift(options) {
    var model = this.at(0);
    return this.remove(model, options);
  }

  // Slice out a sub-array of models from the collection.
  slice() {
    return slice.apply(this.models, arguments);
  }

  // Get a model from the set by id, cid, model object with id or cid
  // properties, or an attributes object that is transformed through modelId.
  get(obj) {
    if (obj == null) return void 0;
    return this._byId[obj] ||
      this._byId[this.modelId(this._isModel(obj) ? obj.attributes : obj)] ||
      obj.cid && this._byId[obj.cid];
  }

  // Returns `true` if the model is in the collection.
  has(obj) {
    return this.get(obj) != null;
  }

  // Get the model at the given index.
  at(index) {
    if (index < 0) index += this.length;
    return this.models[index];
  }

  // Return models with matching attributes. Useful for simple cases of
  // `filter`.
  where(attrs, first) {
    return this[first ? 'find' : 'filter'](attrs);
  }

  // Return the first model with matching attributes. Useful for simple cases
  // of `find`.
  findWhere(attrs) {
    return this.where(attrs, true);
  }

  // Force the collection to re-sort itself. You don't need to call this under
  // normal circumstances, as the set will maintain sort order as each item
  // is added.
  sort(options) {
    var comparator = this.comparator;
    if (!comparator) throw new Error('Cannot sort a set without a comparator');
    options || (options = {});

    var length = comparator.length;
    if (_.isFunction(comparator)) comparator = _.bind(comparator, this);

    // Run sort based on type of `comparator`.
    if (length === 1 || _.isString(comparator)) {
      this.models = this.sortBy(comparator);
    } else {
      this.models.sort(comparator);
    }
    if (!options.silent) this.trigger('sort', this, options);
    return this;
  }

  // Pluck an attribute from each model in the collection.
  pluck(attr) {
    return this.map(attr + '');
  }

  // Fetch the default set of models for this collection, resetting the
  // collection when they arrive. If `reset: true` is passed, the response
  // data will be passed through the `reset` method instead of `set`.
  fetch(options) {
    options = _.extend({parse: true}, options);
    var success = options.success;
    var collection = this;
    options.success = function(resp) {
      var method = options.reset ? 'reset' : 'set';
      collection[method](resp, options);
      if (success) success.call(options.context, collection, resp, options);
      collection.trigger('sync', collection, resp, options);
    };
    wrapError(this, options);
    return this.sync('read', this, options);
  }

  // Create a new instance of a model in this collection. Add the model to the
  // collection immediately, unless `wait: true` is passed, in which case we
  // wait for the server to agree.
  create(model, options) {
    options = options ? _.clone(options) : {};
    var wait = options.wait;
    model = this._prepareModel(model, options);
    if (!model) return false;
    if (!wait) this.add(model, options);
    var collection = this;
    var success = options.success;
    options.success = function(m, resp, callbackOpts) {
      if (wait) collection.add(m, callbackOpts);
      if (success) success.call(callbackOpts.context, m, resp, callbackOpts);
    };
    model.save(null, options);
    return model;
  }

  // **parse** converts a response into a list of models to be added to the
  // collection. The default implementation is just to pass it through.
  parse(resp, options) {
    return resp;
  }

  // Create a new collection with an identical list of models as this one.
  clone() {
    return new this.constructor(this.models, {
      model: this.model,
      comparator: this.comparator
    });
  }

  // Define how to uniquely identify models in the collection.
  modelId(attrs) {
    return attrs[this.model.prototype.idAttribute || 'id'];
  }

  // Get an iterator of all models in this collection.
  values() {
    return new CollectionIterator(this, ITERATOR_VALUES);
  }

  // Get an iterator of all model IDs in this collection.
  keys() {
    return new CollectionIterator(this, ITERATOR_KEYS);
  }

  // Get an iterator of all [ID, model] tuples in this collection.
  entries() {
    return new CollectionIterator(this, ITERATOR_KEYSVALUES);
  }

  // Private method to reset all internal state. Called when the collection
  // is first initialized or reset.
  _reset() {
    this.length = 0;
    this.models = [];
    this._byId  = {};
  }

  // Prepare a hash of attributes (or other model) to be added to this
  // collection.
  _prepareModel(attrs, options) {
    if (this._isModel(attrs)) {
      if (!attrs.collection) attrs.collection = this;
      return attrs;
    }
    options = options ? _.clone(options) : {};
    options.collection = this;
    var model = new this.model(attrs, options);
    if (!model.validationError) return model;
    this.trigger('invalid', this, model.validationError, options);
    return false;
  }

  // Internal method called by both remove and set.
  _removeModels(models, options) {
    var removed = [];
    for (var i = 0; i < models.length; i++) {
      var model = this.get(models[i]);
      if (!model) continue;

      var index = this.indexOf(model);
      this.models.splice(index, 1);
      this.length--;

      // Remove references before triggering 'remove' event to prevent an
      // infinite loop. #3693
      delete this._byId[model.cid];
      var id = this.modelId(model.attributes);
      if (id != null) delete this._byId[id];

      if (!options.silent) {
        options.index = index;
        model.trigger('remove', model, this, options);
      }

      removed.push(model);
      this._removeReference(model, options);
    }
    return removed;
  }

  // Method for checking whether an object should be considered a model for
  // the purposes of adding to the collection.
  _isModel(model) {
    return model instanceof Model;
  }

  // Internal method to create a model's ties to a collection.
  _addReference(model, options) {
    this._byId[model.cid] = model;
    var id = this.modelId(model.attributes);
    if (id != null) this._byId[id] = model;
    model.on('all', this._onModelEvent, this);
  }

  // Internal method to sever a model's ties to a collection.
  _removeReference(model, options) {
    delete this._byId[model.cid];
    var id = this.modelId(model.attributes);
    if (id != null) delete this._byId[id];
    if (this === model.collection) delete model.collection;
    model.off('all', this._onModelEvent, this);
  }

  // Internal method called every time a model in the set fires an event.
  // Sets need to update their indexes when models change ids. All other
  // events simply proxy through. "add" and "remove" events that originate
  // in other collections are ignored.
  _onModelEvent(event, model, collection, options) {
    if (model) {
      if ((event === 'add' || event === 'remove') && collection !== this) return;
      if (event === 'destroy') this.remove(model, options);
      if (event === 'change') {
        var prevId = this.modelId(model.previousAttributes());
        var id = this.modelId(model.attributes);
        if (prevId !== id) {
          if (prevId != null) delete this._byId[prevId];
          if (id != null) this._byId[id] = model;
        }
      }
    }
    this.trigger.apply(this, arguments);
  }
}

var previousBackbone = root.Backbone;


const Backbone$1 = {
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
    Model: Model$1,
    Collection,
};

return Backbone$1;

}());
//# sourceMappingURL=backbone2.js.map
