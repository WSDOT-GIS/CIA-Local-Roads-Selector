﻿/*global require*/
/*jslint browser:true, white:true*/
require(["dojo/on",
	"esri/urlUtils",
	"esri/map",
	"esri/geometry/Point",
	"esri/layers/GraphicsLayer",
	"esri/tasks/RouteTask",
	"esri/renderers/SimpleRenderer",
	"esri/symbols/SimpleMarkerSymbol",
	"esri/symbols/SimpleLineSymbol",
	"esri/graphic",
	"esri/InfoTemplate",
	"esri/dijit/Basemap",
	"esri/dijit/BasemapLayer",
	"esri/layers/ArcGISDynamicMapServiceLayer",
	"esri/tasks/RouteParameters",
	"esri/tasks/FeatureSet",
	"esri/units",
	"dojo/_base/connect",
	"wsdot/tasks/intersectionLocator",
	"esri/dijit/Attribution"],
	function (on, urlUtils, Map, Point, GraphicsLayer, RouteTask, SimpleRenderer, SimpleMarkerSymbol,
		SimpleLineSymbol, Graphic, InfoTemplate, Basemap, BasemapLayer, ArcGISDynamicMapServiceLayer,
		RouteParameters, FeatureSet, Units, connect,
		IntersectionLocator) {
		"use strict";
		var map, locator, routeTask, stopsLayer, routesLayer, protocol, routeLimit;

		// Get the route limit
		routeLimit = window.frameElement ? Number(window.frameElement.dataset.routeLimit) : null;

		function hasExceededRouteLimit() {
			return routeLimit !== null && routesLayer.graphics.length >= routeLimit;
		}

		// Store the protocol (e.g., "https:")
		protocol = window.location.protocol;

		/**Converts an AddressCandidate into a string with the entire address on a single line.
		* (e.g., "742 Evergreen Terrace, Springfield, NT  58008")
		* @returns {string} An address on a single line.
		*/
		function /*string*/ addressCandidateToSingleLine(/*esri.tasks.AddressCandidate*/ addressCandidate) {
			var output = [], address;
			if (addressCandidate && addressCandidate.address) {
				address = addressCandidate.address;
				output.push(address.Address, ", ");
				output.push(address.City, ", ", address.Region, "  ", address.Postal);
			}
			return output.join("");
		}

		function setDisabledStatusOfButtons() {
			var deleteButton = document.getElementById("deleteButton"), clearButton = document.getElementById("clearButton");
			deleteButton.disabled = clearButton.disabled = !(stopsLayer.graphics.length > 0 || routesLayer.graphics.length > 0);
		}

		/** @callback {LayerGraphicEvent}
		 * @property {Graphic} graphic
		 * @property {GraphicsLayer} target
		 */

		function postGraphicAddMessage(e) {
			var message = {
				layerId: e.target.id,
				action: "added",
				graphic: e.graphic.toJson()
			};
			window.parent.postMessage(message, [location.protocol, location.host].join("//"));
		}

		function postGraphicRemoveMessage(e) {
			var message = {
				layerId: e.target.id,
				action: "removed",
				graphic: e.graphic.toJson()
			};
			window.parent.postMessage(message, [location.protocol, location.host].join("//"));
		}

		/** Removes the last graphic from a layer list.
		 * @returns {Graphic} Returns the graphic that was removed.
		 */
		function removeLastGraphic(/**{GraphicsLayer}*/ layer) {
			var graphic = null;
			if (layer.graphics.length > 0) {
				graphic = layer.graphics[layer.graphics.length - 1];
				layer.remove(graphic);
			}
			return graphic;
		}

		/** Event handler for delete button.
		 * If the clicked button is the "clearButton", all graphics from a layer will be cleared.
		 */
		function deleteStopOrRoute(/** {MouseEvent} */ e) {
			var buttonId = e.target.id;
			if (stopsLayer.graphics.length > 0) {
				if (buttonId === "clearButton") {
					stopsLayer.clear();
				} else {
					removeLastGraphic(stopsLayer);
				}
			} else if (routesLayer.graphics.length > 0) {
				if (buttonId === "clearButton") {
					routesLayer.clear();
				} else {
					removeLastGraphic(routesLayer);
				}
			}
		}

		document.getElementById("deleteButton").addEventListener("click", deleteStopOrRoute);
		document.getElementById("clearButton").addEventListener("click", deleteStopOrRoute);
		

		// Set the routing URL to use a proxy.  The proxy will handle getting tokens.
		urlUtils.addProxyRule({
			proxyUrl: "proxy.ashx",
			urlPrefix: protocol + "//route.arcgis.com"
		});

		// Create the map.
		map = new Map("map", {
			basemap: new Basemap({
				id: "Hybrid",
				layers: [
					new BasemapLayer({ url: protocol + "//services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" }),
					new BasemapLayer({ url: protocol + "//services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer" }),
					new BasemapLayer({ url: protocol + "//services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer" })
				]
			}),
			center: [-120.80566406246835, 47.41322033015946],
			zoom: 7,
			showAttribution: true
		});

		connect.connect(map, "onUpdateStart", function () {
			document.getElementById("mapProgress").hidden = false;
		});

		connect.connect(map, "onUpdateEnd", function () {
			document.getElementById("mapProgress").hidden = true;
		});

		// Create the event handler for when the map finishes loading...
		map.on("load", function () {
			var symbol;

			// Disable zooming on map double-click.  Double click will be used to create a route.
			map.disableDoubleClickZoom();

			// Create the graphics layer that will be used to show the stop graphics.
			stopsLayer = new GraphicsLayer({
				id: "stops"
			});
			stopsLayer.setInfoTemplate(new InfoTemplate("Address", "${Name}"));
			symbol = new SimpleMarkerSymbol();
			symbol.setColor("00ccff");
			stopsLayer.setRenderer(new SimpleRenderer(symbol));
			map.addLayer(stopsLayer);

			// Create the routes graphics layer.
			routesLayer = new GraphicsLayer({
				id: "routes"
			});
			routesLayer.setInfoTemplate(new InfoTemplate("Route", "${Name}"));
			symbol = new SimpleLineSymbol();
			symbol.setColor("00ccff");
			symbol.setWidth(10);
			routesLayer.setRenderer(new SimpleRenderer(symbol));
			map.addLayer(routesLayer);

			// Assign event handlers to layers.
			[stopsLayer, routesLayer].forEach(function (layer) {
				layer.on("graphic-add", setDisabledStatusOfButtons);
				layer.on("graphic-remove", setDisabledStatusOfButtons);

				layer.on("graphic-add", postGraphicAddMessage);
				layer.on("graphic-remove", postGraphicRemoveMessage);
			});

			// Setup the locator.
			locator = new IntersectionLocator(protocol + "ReverseGeocodeIntersection.ashx");
			locator.setOutSpatialReference(map.spatialReference);
			

			// Setup the route task.
			routeTask = new RouteTask(protocol + "//route.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World");

			// Setup the map click event that will call the geocoder service.
			map.on("click", function (evt) {
				if (evt.mapPoint && !hasExceededRouteLimit()) {
					locator.locationToIntersection(evt.mapPoint, 10, function (/*esri.tasks.AddressCandidate*/ addressCandidate) {
						var graphic = new Graphic();
						graphic.setGeometry(addressCandidate.location);
						graphic.setAttributes({
							Name: addressCandidateToSingleLine(addressCandidate)
						});
						stopsLayer.add(graphic);
					}, function (error) {
						window.console.error(error);
					});
				}
			});

			// Setup the map double-click event to call the route service when two or more geocoded points are displayed on the map.
			map.on("dbl-click", function (event) {
				if (event.mapPoint && stopsLayer.graphics.length >= 2) {
					var routeParams, features;

					features = new FeatureSet();
					features.features = stopsLayer.graphics;
					routeParams = new RouteParameters();
					routeParams.stops = features;
					routeParams.returnRoutes = true;
					routeParams.returnDirections = false;
					routeParams.directionsLengthUnits = Units.MILES;
					routeParams.outSpatialReference = map.spatialReference;
					routeParams.restrictionAttributes = ["none"];

					routeTask.solve(routeParams, function (solveResults) {
						/* 
						@param {Array} solveResults.barriers
						@param {Array} solveResults.messages
						@param {Array} solveResults.polygonBarriers
						@param {Array} solveResults.polylineBarriers
						@param {esri.tasks.RouteResult[]} solveResults.routeResults

						{Graphic} routeResult.route
						{string} routeResult.routeName
						*/
						var i, l;
						if (solveResults && solveResults.routeResults && solveResults.routeResults.length) {
							for (i = 0, l = solveResults.routeResults.length; i < l; i += 1) {
								routesLayer.add(solveResults.routeResults[i].route);
							}
						}

						stopsLayer.clear();
						window.console.log(solveResults);
					}, routeParams, function (error) {
						window.console.error(error);
					});
				}
			});
		});
	});