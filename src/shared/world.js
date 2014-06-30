// -*- Mode: js; indent-tabs-mode: nil; c-basic-offset: 4; tab-width: 4 -*-
//
// Copyright (c) 2012 Giovanni Campagna <scampa.giovanni@gmail.com>
//
// Gnome Weather is free software; you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by the
// Free Software Foundation; either version 2 of the License, or (at your
// option) any later version.
//
// Gnome Weather is distributed in the hope that it will be useful, but
// WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
// or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License
// for more details.
//
// You should have received a copy of the GNU General Public License along
// with Gnome Weather; if not, write to the Free Software Foundation,
// Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA

const Gd = imports.gi.Gd;
const GdkPixbuf = imports.gi.GdkPixbuf;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const GWeather = imports.gi.GWeather;
const Lang = imports.lang;

const Params = imports.misc.params;
const Util = imports.misc.util;

const Columns = {
    ID: Gd.MainColumns.ID,
    URI: Gd.MainColumns.URI,
    PRIMARY_TEXT: Gd.MainColumns.PRIMARY_TEXT,
    SECONDARY_TEXT: Gd.MainColumns.SECONDARY_TEXT,
    ICON: Gd.MainColumns.ICON,
    MTIME: Gd.MainColumns.MTIME,
    SELECTED: Gd.MainColumns.SELECTED,
    PULSE: Gd.MainColumns.PULSE,
    LOCATION: Gd.MainColumns.LAST,
    INFO: Gd.MainColumns.LAST+1,
    AUTOMATIC: Gd.MainColumns.LAST+2
};
const ColumnTypes = {
    ID: String,
    URI: String,
    PRIMARY_TEXT: String,
    SECONDARY_TEXT: String,
    ICON: GdkPixbuf.Pixbuf,
    MTIME: GObject.Int,
    SELECTED: Boolean,
    PULSE: GObject.UInt,
    LOCATION: GWeather.Location,
    INFO: GWeather.Info,
    AUTOMATIC: Boolean
};
Util.assertEqual(Object.keys(Columns).length, Object.keys(ColumnTypes).length);
Util.assertEqual(Gd.MainColumns.LAST+3, Object.keys(ColumnTypes).length);

const ICON_SIZE = 128;

const WorldModel = new Lang.Class({
    Name: 'WorldModel',
    Extends: Gtk.ListStore,
    Signals: {
        'updated': { param_types: [ GWeather.Info ] }
    },
    Properties: {
        'loading': GObject.ParamSpec.boolean('loading', '', '', GObject.ParamFlags.READABLE, false)
    },

    _init: function(world, enableGtk) {
        this.parent();
        this.set_column_types([ColumnTypes[c] for (c in ColumnTypes)]);
        this._world = world;

        this._settings = Util.getSettings('org.gnome.Weather.Application');

        let provider_override = GLib.getenv('GWEATHER_DEBUG_BACKEND');
        if (provider_override) {
            this._providers = GWeather.Provider.METAR | GWeather.Provider[provider_override];
        } else {
            this._providers = GWeather.Provider.METAR | GWeather.Provider.YR_NO |
                GWeather.Provider.OWM;
        }

        this._loadingCount = 0;

        let locations = this._settings.get_value('locations').deep_unpack();
        for (let i = 0; i < locations.length; i++) {
            let variant = locations[i];
            let location = this._world.deserialize(variant);
            this._addLocationInternal(location, false);
        }

        this._settings.connect('changed::locations', Lang.bind(this, this._onChanged));

        this._enableGtk = enableGtk;
    },

    _updateLoadingCount: function(delta) {
        let wasLoading = this._loadingCount > 0;
        this._loadingCount += delta;
        let isLoading = this._loadingCount > 0;

        if (wasLoading != isLoading)
            this.notify('loading');
    },

    updateInfo: function(info) {
        info.update();
        this._updateLoadingCount(+1);
    },

    get loading() {
        return this._loadingCount > 0;
    },

    _addLocationInternal: function(location, automatic) {
        let info = new GWeather.Info({ location: location,
                                       enabled_providers: this._providers });
        let iter;
        info.connect('updated', Lang.bind(this, function(info) {
            let secondary_text = Util.getWeatherConditions(info);
            if (this._enableGtk) {
                let icon = Util.loadIcon(info.get_symbolic_icon_name(), ICON_SIZE);
                this.set(iter,
                         [Columns.ICON, Columns.SECONDARY_TEXT],
                         [icon, secondary_text]);
            } else {
                this.set_value(iter, Columns.SECONDARY_TEXT, secondary_text);
            }

            this._updateLoadingCount(-1);
            this.emit('updated', info);
        }));
        this.updateInfo(info);

        let primary_text = location.get_city_name();

        iter = this.insert_with_valuesv(-1,
                                        [Columns.PRIMARY_TEXT,
                                         Columns.LOCATION,
                                         Columns.INFO,
                                         Columns.AUTOMATIC],
                                        [primary_text,
                                         location,
                                         info,
                                         automatic]);

        if (this._enableGtk) {
            let icon = Util.loadIcon('view-refresh-symbolic', ICON_SIZE);
            this.set_value(iter, Columns.ICON, icon);
        }
    },

    _onChanged: function() {
        let newLocations = this._settings.get_value('locations').deep_unpack();
        let toErase = [];

        let [ok, iter] = this.get_iter_first();
        while (ok) {
            let auto = this.get_value(iter, Columns.AUTOMATIC);
            if (auto) {
                ok = this.iter_next(iter);
                continue;
            }
            let location = this.get_value(iter, Columns.LOCATION);

            let found = false;
            for (let j = 0; j < newLocations.length; j++) {
                let variant = newLocations[j];
                if (variant == null)
                    continue;

                let newLocation = this._world.deserialize(variant);

                if (location.equal(newLocation)) {
                    newLocations[j] = null;
                    found = true;
                    break;
                }
            }

            if (!found)
                toErase.push(iter.copy());

            ok = this.iter_next(iter);
        }

        for (let i = 0; i < toErase.length; i++)
            this.remove(toErase[i]);

        for (let i = 0; i < newLocations.length; i++) {
            let variant = newLocations[i];
            if (variant == null)
                continue;

            let newLocation = this._world.deserialize(variant);
            this._addLocationInternal(newLocation, false);
        }
    },

    _addSavedLocation: function(location) {
        let newLocations = this._settings.get_value('locations').deep_unpack();
        newLocations.push(location.serialize());
        this._settings.set_value('locations', new GLib.Variant('av', newLocations));
    },

    getAllSavedLocations: function() {
        let locations = this._settings.get_value('locations').deep_unpack();
        let returnValue = [];

        for (let i = 0; i < locations.length; i++) {
            let variant = locations[i];
            if (variant == null) {
                log('null stored in GSettings?');
                continue;
            }

            returnValue.push(this._world.deserialize(variant));
        }

        return returnValue;
    },

    getLocationInfo: function(location) {
        let [ok, iter] = this.get_iter_first();
        while (ok) {
            let storedLocation = this.get_value(iter, Columns.LOCATION);
            if (storedLocation.equal(location))
                return this.get_value(iter, Columns.INFO);

            ok = this.iter_next(iter);
        }

        return null;
    },

    addLocation: function(location, saved) {
        if (saved)
            this._addSavedLocation(location);
        else
            this._addLocationInternal(location, true);
    },

    removeLocation: function(iter) {
        let auto = this.get_value(iter, Columns.AUTOMATIC);
        if (auto) {
            this.remove(iter);
            return;
        }

        let location = this.get_value(iter, Columns.LOCATION);
        let variant = location.serialize();

        let newLocations = this._settings.get_value('locations').deep_unpack();

        for (let i = 0; i < newLocations.length; i++) {
            if (newLocations[i].equal(variant)) {
                newLocations.splice(i, 1);
                break;
            }
        }

        this._settings.set_value('locations', new GLib.Variant('av', newLocations));
    },
});

const WorldIconView = new Lang.Class({
    Name: 'WorldView',
    Extends: Gd.MainView,

    _init: function(params) {
        params = Params.fill(params, { view_type: Gd.MainViewType.ICON });
        this.parent(params);
        this.get_accessible().accessible_name = _("Cities");

        this.connect('selection-mode-request', Lang.bind(this, function() {
            this.selection_mode = true;
        }));
    }
});

const WorldContentView = new Lang.Class({
    Name: 'WorldContentView',
    Extends: Gtk.Bin,
    Properties: { 'empty': GObject.ParamSpec.boolean('empty', '', '', GObject.ParamFlags.READABLE, false) },

    _init: function(model, params) {
        params = Params.fill(params, { hexpand: true, vexpand: true,
                                       halign: Gtk.Align.FILL, valign: Gtk.Align.FILL });
        this.parent(params);
        this.get_accessible().accessible_name = _("World view");

        this.iconView = new WorldIconView({ model: model, visible: true });

        this._placeHolder = new Gtk.Grid({ halign: Gtk.Align.CENTER,
                                           valign: Gtk.Align.CENTER,
                                           name: 'weather-page-placeholder',
                                           column_spacing: 6 });
        this._placeHolder.get_style_context().add_class('dim-label');

        let iconGrid = new Gtk.Grid({ row_spacing: 4, column_spacing: 4,
                                      valign: Gtk.Align.CENTER });
        iconGrid.attach(new Gtk.Image({ icon_name: 'weather-overcast-symbolic',
                                        icon_size: Gtk.IconSize.LARGE_TOOLBAR }),
                        0, 0, 1, 1);
        iconGrid.attach(new Gtk.Image({ icon_name: 'weather-few-clouds-symbolic',
                                        icon_size: Gtk.IconSize.LARGE_TOOLBAR }),
                        1, 0, 1, 1);
        iconGrid.attach(new Gtk.Image({ icon_name: 'weather-clear-symbolic',
                                        icon_size: Gtk.IconSize.LARGE_TOOLBAR }),
                        0, 1, 1, 1);
        iconGrid.attach(new Gtk.Image({ icon_name: 'weather-showers-symbolic',
                                        icon_size: Gtk.IconSize.LARGE_TOOLBAR }),
                        1, 1, 1, 1);

        this._placeHolder.attach(iconGrid, 0, 0, 1, 2);

        this._placeHolder.attach(new Gtk.Label({ name: 'weather-page-placeholder-title',
                                                 label: _("Add locations"),
                                                 xalign: 0.0 }),
                                 1, 0, 1, 1);
        this._placeHolder.attach(new Gtk.Label({ label: _("Use the <b>New</b> button on the toolbar to add more world locations"),
                                                 use_markup: true,
                                                 max_width_chars: 30,
                                                 wrap: true,
                                                 xalign: 0.0,
                                                 halign: Gtk.Align.START,
                                                 valign: Gtk.Align.START }),
                                 1, 1, 1, 1);
        this._placeHolder.show_all();

        this.model = model;
        this._rowInsertedId = model.connect('row-inserted', Lang.bind(this, this._updateEmpty));
        this._rowDeletedId = model.connect('row-deleted', Lang.bind(this, this._updateEmpty));

        let [ok, ] = model.get_iter_first();
        if (ok)
            this.add(this.iconView);
        else
            this.add(this._placeHolder);
        this._empty = !ok;

        this.connect('destroy', Lang.bind(this, this._onDestroy));
    },

    get empty() {
        return this._empty;
    },

    _onDestroy: function() {
        if (this._rowInsertedId) {
            this.model.disconnect(this._rowInsertedId);
            this._rowInsertedId = 0;
        }
        if (this._rowDeletedId) {
            this.model.disconnect(this._rowDeletedId);
            this._rowDeletedId = 0;
        }
    },

    _updateEmpty: function() {
        let [ok, iter] = this.model.get_iter_first();

        if (!ok != this._empty) {
            if (ok) {
                this.remove(this._placeHolder);
                this.add(this.iconView);
            } else {
                this.remove(this.iconView);
                this.add(this._placeHolder);
            }

            this._empty = !ok;
            this.notify('empty');
        }
    }
});