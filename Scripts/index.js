/*global require*/
/*jslint browser:true, white:true*/
require([
	"dijit/layout/BorderContainer",
	"dijit/layout/ContentPane",
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
	"esri/tasks/RouteParameters",
	"esri/tasks/FeatureSet",
	"esri/units",
	"dojo/_base/connect",
	"wsdot/tasks/intersectionLocator", "dojo/domReady!"],
	function (BorderContainer, ContentPane, urlUtils, Map, Point, GraphicsLayer, RouteTask, SimpleRenderer, SimpleMarkerSymbol,
		SimpleLineSymbol, Graphic, InfoTemplate, Basemap, BasemapLayer,
		RouteParameters, FeatureSet, Units, connect,
		IntersectionLocator) {
		"use strict";
		var map, locator, routeTask, stopsLayer, routesLayer, protocol, mapPane, listPane;

		/** Sets up the border container layout for the page.
		 */
		function setupBorderContainer() {
			var bc;

			bc = new BorderContainer({
				gutters: false,
				design: "sidebar"
			}, "borderContainer");

			mapPane = new ContentPane({
				region: "center",
				id: "mapPane"
			}, "mapPane");
			bc.addChild(mapPane);

			listPane = new ContentPane({
				region: "right",
				id: "listPane",
				splitter: true
			}, "listPane");
			bc.addChild(listPane);

			bc.startup();
		}

		setupBorderContainer();

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

		// Set the routing URL to use a proxy.  The proxy will handle getting tokens.
		urlUtils.addProxyRule({
			proxyUrl: "proxy.ashx",
			urlPrefix: protocol + "//route.arcgis.com"
		});
		urlUtils.addProxyRule({
			proxyUrl: "proxy.ashx",
			urlPrefix: protocol + "//traffic.arcgis.com"
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

			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(function (position) {
					var x, y;
					x = position.coords.longitude;
					y = position.coords.latitude;
					map.centerAndZoom(new Point(x, y), 15);
				}, function (error) {
					window.console.error(error);
				});
			}

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

			// DEBUG
			window.stopsLayer = stopsLayer;

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

			// DEBUG
			window.routesLayer = routesLayer;

			// Setup the locator.
			locator = new IntersectionLocator(protocol + "ReverseGeocodeIntersection.ashx");
			locator.setOutSpatialReference(map.spatialReference);
			

			// Setup the route task.
			routeTask = new RouteTask(protocol + "//route.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World");

			// Setup the map click event that will call the geocoder service.
			map.on("click", function (evt) {
				if (evt.mapPoint) {
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
						var i, l, j, jl, routeGraphic;
						if (solveResults && solveResults.routeResults && solveResults.routeResults.length) {
							for (i = 0, l = solveResults.routeResults.length; i < l; i += 1) {
								routeGraphic = solveResults.routeResults[i].route;

								// Add stops attribute to route graphic
								routeGraphic.attributes.stops = [];
								// Loop through the stops layer and add the stop point graphics 
								// to the "stops" attribute of the route graphic.
								for (j = 0, jl = stopsLayer.graphics.length; j < jl; j += 1) {
									routeGraphic.attributes.stops.push(stopsLayer.graphics[j]);
								}

								routesLayer.add(routeGraphic);
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