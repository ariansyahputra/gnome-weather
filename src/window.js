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

const City = imports.city;
const World = imports.world;
const Util = imports.util;

const Gettext = imports.gettext;
const Tweener = imports.tweener.tweener;

const Page = {
    WORLD: 0,
    CITY: 1
};

const MainWindow = new Lang.Class({
    Name: 'MainWindow',
    Extends: Gtk.ApplicationWindow,

    _init: function(params) {
        params = Params.fill(params, { hide_titlebar_when_maximized: true,
                                       width_request: 700,
                                       height_request: 520 });
        this.parent(params);

        this._world = this.application.world;
        this._currentInfo = null;
        this._currentPage = Page.WORLD;
        this._pageWidgets = [[],[]];

        Util.initActions(this,
                         [{ name: 'new',
                            callback: this._newLocation },
                          { name: 'preferences',
                            callback: this._showPreferences },
                          { name: 'about',
                            callback: this._showAbout },
                          { name: 'exit-selection-mode',
                            callback: this._exitSelectionMode },
                          { name: 'select-all',
                            callback: this._selectAll },
                          { name: 'select-none',
                            callback: this._selectNone },
                          { name: 'delete-selected',
                            callback: this._deleteSelected }]);

        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/weather/window.ui');

        let grid = builder.get_object('main-panel');
        this._header = builder.get_object('header-bar');

        let newButton = builder.get_object('new-button');
        newButton.connect('clicked', Lang.bind(this, this._newLocation));
        this._pageWidgets[Page.WORLD].push(newButton);

        let goWorldButton = builder.get_object('world-button');
        goWorldButton.connect('clicked', Lang.bind(this, this._goWorld));
        this._pageWidgets[Page.CITY].push(goWorldButton);

        let select = builder.get_object('select-button');
        this._pageWidgets[Page.WORLD].push(select);

        let refresh = builder.get_object('refresh-button');
        refresh.connect('clicked', Lang.bind(this, this.update));
        this._pageWidgets[Page.CITY].push(refresh);

        let selectDone = builder.get_object('done-button');
        this._pageWidgets[Page.WORLD].push(selectDone);

        let selectionBarRevealer = builder.get_object('selection-bar-revealer');
        let selectionMenu = builder.get_object("selection-menu");

        this._selectionMenuButton = builder.get_object('selection-menu-button');
        this._stack = builder.get_object('main-stack');

        this._cityView = new City.WeatherView({ hexpand: true,
                                                vexpand: true });
        this._stack.add(this._cityView);

        this._worldView = new World.WorldContentView(this.application.model, { visible: true });
        let iconView = this._worldView.iconView;
        this._stack.add(this._worldView);

        iconView.connect('item-activated', Lang.bind(this, this._itemActivated));

        select.connect('clicked', Lang.bind(this, function() {
            this._worldView.iconView.selection_mode = true;
        }));
        iconView.connect('notify::selection-mode', Lang.bind(this, function() {
            if (iconView.selection_mode) {
                this._header.get_style_context().add_class('selection-mode');
                this._header.set_custom_title(this._selectionMenuButton);
            } else {
                this._header.get_style_context().remove_class('selection-mode');
                this._header.set_custom_title(null);
            }
        }));

        iconView.bind_property('selection-mode', newButton, 'visible',
                               GObject.BindingFlags.INVERT_BOOLEAN);
        iconView.bind_property('selection-mode', select, 'visible',
                               GObject.BindingFlags.INVERT_BOOLEAN);
        iconView.bind_property('selection-mode', selectDone, 'visible',
                               GObject.BindingFlags.SYNC_CREATE);
        iconView.bind_property('selection-mode', selectionBarRevealer, 'reveal-child',
                               GObject.BindingFlags.SYNC_CREATE);
        this._worldView.bind_property('empty', select, 'sensitive',
                                      GObject.BindingFlags.SYNC_CREATE |
                                      GObject.BindingFlags.INVERT_BOOLEAN);

        this._stack.set_visible_child(this._worldView);

        iconView.connect('view-selection-changed', Lang.bind(this, function() {
            let items = iconView.get_selection();
            let label;

            if (items.length > 0) {
                label = Gettext.ngettext("%d selected",
                                         "%d selected",
                                         items.length).format(items.length);
            } else {
                label = _("Click on locations to select them");
            }

            this._selectionMenuButton.set_label(label);
        }));

        this.add(grid);
        grid.show_all();

        for (let i = 0; i < this._pageWidgets[Page.CITY].length; i++)
            this._pageWidgets[Page.CITY][i].hide();
    },

    update: function() {
        this._cityView.update();
    },

    _getTitle: function() {
        if (this._currentPage == Page.WORLD)
            return ['', null];

        let location = this._cityView.info.location;
        let city = location;
        if (location.get_level() == GWeather.LocationLevel.WEATHER_STATION)
            city = location.get_parent();

        let country = city.get_parent();
        while (country &&
               country.get_level() > GWeather.LocationLevel.COUNTRY)
            country = country.get_parent();

        if (country)
            return [city.get_name(), country.get_name()];
        else
            return [city.get_name(), null];
    },

    _goToPage: function(page) {
        if (page == this._currentPage)
            return;

        for (let i = 0; i < this._pageWidgets[this._currentPage].length; i++)
            this._pageWidgets[this._currentPage][i].hide();

        for (let i = 0; i < this._pageWidgets[page].length; i++) {
            let widget = this._pageWidgets[page][i];
            if (!widget.no_show_all)
                this._pageWidgets[page][i].show();
        }

        this._currentPage = page;

        let [title, subtitle] = this._getTitle();
        this._header.title = title;
        this._header.subtitle = subtitle;
    },

    _itemActivated: function(view, id, path) {
        let [ok, iter] = view.model.get_iter(path);
        let info = view.model.get_value(iter, World.Columns.INFO);

        this._cityView.info = info;
        this._stack.set_visible_child(this._cityView);
        this._goToPage(Page.CITY);
    },

    _goWorld: function() {
        this._stack.set_visible_child(this._worldView);
        this._goToPage(Page.WORLD);
    },

    _newLocation: function() {
        let dialog = new Gtk.Dialog({ title: _("New Location"),
                                      transient_for: this.get_toplevel(),
                                      modal: true });

        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/weather/new-location-dialog.ui');

        let grid = builder.get_object('location-dialog-content');

        let find_icon = Gio.ThemedIcon.new_with_default_fallbacks("edit-find-symbolic");
        let entry = new GWeather.LocationEntry({ top: this._world,
                                                 width_request: 400,
                                                 activates_default: true });
        entry.set_icon_from_gicon(Gtk.EntryIconPosition.SECONDARY, find_icon);

        grid.attach(entry, 0, 1, 1, 1);
        dialog.get_content_area().add(grid);

        dialog.add_button(Gtk.STOCK_CANCEL, Gtk.ResponseType.CANCEL);
        dialog.add_button(Gtk.STOCK_ADD, Gtk.ResponseType.OK);
        dialog.set_default_response(Gtk.ResponseType.OK);

        dialog.connect('response', Lang.bind(this, function(dialog, response) {
            dialog.destroy();

            if (response != Gtk.ResponseType.OK)
                return;

            let location = entry.location;
            if (!location)
                return;

            this._worldView.model.addLocation(entry.location);
        }));
        dialog.show_all();
    },

    _exitSelectionMode: function() {
        this._worldView.iconView.selection_mode = false;
    },

    _selectAll: function() {
        this._worldView.iconView.selection_mode = true;
        this._worldView.iconView.select_all();
    },

    _selectNone: function() {
        this._worldView.iconView.unselect_all();
    },

    _showAbout: function() {
        let artists = [ 'Jakub Steiner <jimmac@gmail.com>',
                        'Pink Sherbet Photography (D. Sharon Pruitt)',
                        'Elliott Brown',
                        'Analogick',
                        'DBduo Photography (Daniel R. Blume)',
                        'davharuk',
                        'Tech Haven Ministries',
                        'Jim Pennucci' ];
        let aboutDialog = new Gtk.AboutDialog(
            { artists: artists,
              authors: [ 'Giovanni Campagna <gcampagna@src.gnome.org>' ],
              translator_credits: _("translator-credits"),
              program_name: _("Weather"),
              comments: _("A weather application"),
              copyright: 'Copyright 2013 The Weather Developers',
              license_type: Gtk.License.GPL_2_0,
              logo_icon_name: 'weather-clear',
              version: pkg.version,
              website: 'https://live.gnome.org/Design/Apps/Weather',
              wrap_license: true,
              modal: true,
              transient_for: this
            });

        aboutDialog.show();
        aboutDialog.connect('response', function() {
            aboutDialog.destroy();
        });
    },

    _showPreferences: function() {
        let builder = new Gtk.Builder();
        builder.add_from_resource('/org/gnome/weather/preferences.ui');

        let dialog = builder.get_object('preferences-dialog');
        dialog.transient_for = this;

        let settings = new Gio.Settings({ schema: 'org.gnome.GWeather' });
        settings.bind('temperature-unit', builder.get_object('temp-combo'), 'active-id',
                      Gio.SettingsBindFlags.DEFAULT);
        settings.bind('speed-unit', builder.get_object('speed-combo'), 'active-id',
                      Gio.SettingsBindFlags.DEFAULT);
        settings.bind('distance-unit', builder.get_object('distance-combo'), 'active-id',
                      Gio.SettingsBindFlags.DEFAULT);
        settings.bind('pressure-unit', builder.get_object('pressure-combo'), 'active-id',
                      Gio.SettingsBindFlags.DEFAULT);

        dialog.add_button(Gtk.STOCK_CLOSE, Gtk.ResponseType.CLOSE);
        dialog.set_default_response(Gtk.ResponseType.CLOSE);
        dialog.connect('response', function(d) { d.destroy(); });

        dialog.show();
    },

    _deleteSelected: function() {
        let items = this._worldView.iconView.get_selection();
        let model = this._worldView.iconView.model;

        for (let i = items.length - 1; i >= 0; i--) {
            let [res, iter] = model.get_iter(items[i]);
            if (res)
                model.removeLocation(iter);
        }

        this._exitSelectionMode();
    },
});
