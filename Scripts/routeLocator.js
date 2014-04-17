/*global require, Terraformer*/
/*jslint browser:true, white:true,vars:true*/
require([
	"esri/urlUtils",
	"esri/map",
	"esri/layers/GraphicsLayer",
	"esri/tasks/RouteTask",
	"esri/renderers/SimpleRenderer",
	"esri/symbols/SimpleMarkerSymbol",
	"esri/symbols/SimpleLineSymbol",
	"esri/graphic",
	"esri/SpatialReference",
	"esri/geometry/Extent",
	"esri/geometry/Polyline",
	"esri/InfoTemplate",
	"esri/dijit/Basemap",
	"esri/dijit/BasemapLayer",
	"esri/tasks/RouteParameters",
	"esri/tasks/FeatureSet",
	"esri/units",
	"dojo/_base/connect",
	"wsdot/tasks/intersectionLocator",
	"proj4js"
], function (urlUtils, Map, GraphicsLayer, RouteTask, SimpleRenderer, SimpleMarkerSymbol,
		SimpleLineSymbol, Graphic, SpatialReference, Extent, Polyline, InfoTemplate, Basemap, BasemapLayer,
		RouteParameters, FeatureSet, Units, connect,
		IntersectionLocator, proj4) {
	"use strict";
	var map, locator, routeTask, stopsLayer, routesLayer, protocol, waPrj, mapPrj;

	waPrj = "+proj=lcc +lat_1=47.33333333333334 +lat_2=45.83333333333334 +lat_0=45.33333333333334 +lon_0=-120.5 +x_0=500000.0001016001 +y_0=0 +ellps=GRS80 +to_meter=0.3048006096012192 +no_defs";
	mapPrj = "+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext  +no_defs";

	/** Reduces the name of the route. See Notes.md for detailed description of how this method works.
	 * @param {string} name
	 * @returns {string}
	 */
	function reduceRouteName(name) {
		var output = name;
		var streetAndCrossStreetRe = /(?:([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s+(\d+))\s-\s(?:(?:([^&]+)\s&\s+\1,\s\3,\s\4\s+\5)|(?:\1\s&\s+([^,]+),\s\3,\s\4\s+\5)|(?:([^&]+)\s&\s+\2,\s\3,\s\4\s+\5)|(?:\2\s&\s+([^,]+),\s\3,\s\4\s+\5))/i;

		/**
		 (?:
			(?<street1>[^&]+)
			\s&\s+
			(?<street2>[^,]+)
			,\s
			(?<city>[^,]+)
			,\s
			(?<state>[a-z]+)
			\s+
			(?<zip>\d+)
		)
		\s-\s # Separator between intersections
		(?:
			(?:([^&]+)\s&\s+${street1},\s${city},\s${state}\s+${zip}) # capture 6 is the other cross street - if not undefined then street1 is the main street
			|
			(?:${street1}\s&\s+([^,]+),\s${city},\s${state}\s+${zip}) # capture 7 is the other cross street - if not undefined then street1 is the main street
			|
			(?:([^&]+)\s&\s+${street2},\s${city},\s${state}\s+${zip}) # capture 8 is the other cross street - if not undefined then street2 is the main street
			|
			(?:${street2}\s&\s+([^,]+),\s${city},\s${state}\s+${zip}) # capture 9 is the other cross street - if not undefined then street2 is the main street
		)

		*/

		var match = name.match(streetAndCrossStreetRe);

		var mainStreet, cross1, cross2, city, state, zip;
		if (match) {
			city = match[3];
			state = match[4];
			zip = match[5];
			if (match[6]) {
				mainStreet = match[1];
				cross1 = match[2];
				cross2 = match[6];
			} else if (match[7]) {
				mainStreet = match[1];
				cross1 = match[2];
				cross2 = match[7];
			} else if (match[8]) {
				mainStreet = match[2];
				cross1 = match[1];
				cross2 = match[8];
			} else {
				mainStreet = match[1];
				cross1 = match[2];
				cross2 = match[9];
			}

			output = [mainStreet, " from ", cross1, " to ", cross2, ", ", city, ", ", state, " ", zip].join("");

		}
		return output;
	}

	/** @typedef {(string|proj4.Proj)} Projection
	 * 
	 */

	/** @typedef {object} ThisProjectionInfo
	 * @property {?Projection} inPrj
	 * @property {?Projection} outPrj
	 */

	/** @typedef {(Number[]|Array<Array<Number>>|<Array<Array<Array<Number>>>)} ProjectableArray
	 * 
	 */

	/** For use with the Array.prototype.map() function.
	 * @param {ProjectableArray} a
	 * @this {ThisProjectionInfo}
	 */
	function projectMap(a) {
		/*jshint validthis:true*/
		return projectCoords(a, this.inPrj, this.outPrj);
		/*jshint validthis:false*/
	}


	/** projects coordinates in an array.
	 * @param {ProjectableArray} array - An array of numbers or an array containing arrays of numbers.
	 * @param {Projection} inPrj - input projection.
	 * @param {Projection} [outPrj] - output projection.
	 * @returns {ProjectableArray} - The projected version of the input array.
	 */
	function projectCoords(array, inPrj, outPrj) {
		var output;

		if (array && array.length) {
			if (array[0] instanceof Array) {
				output = array.map(projectMap, {
					inPrj: inPrj,
					outPrj: outPrj
				});
			} else if (typeof array[0] === "number") {
				output = proj4(inPrj, outPrj, array);
			}
		} else {
			output = array;
		}
		return output;
	}

	/**
	 * Converts an ArcGIS JS API polyline or polygon in the Web Merc. Aux. Sphere projectetion into WA SPS projected WKT.
	 * @returns {string}
	 */
	function getProjectedTerraformerPrimitive(/**{(Polyline|Polygon)}*/ g, inPrj, outPrj) {
		var output, pathsPropName = g.paths ? "paths" : g.rings ? "rings" : null /*,path, coords, outPath, i, l, j, jl*/;
		// Set default value for input projection.
		inPrj = inPrj || mapPrj;
		outPrj = outPrj || waPrj;
		if (pathsPropName) {
			output = projectCoords(g[pathsPropName], inPrj, outPrj);
		}

		// The geometry type is determined by presence of either "paths" or "rings" attribute.
		output = pathsPropName === "paths" ? new Terraformer.MultiLineString(output) : new Terraformer.Polygon(output);

		return output;
	}

	/**
	 * Converts an ArcGIS JS API polyline or polygon in the Web Merc. Aux. Sphere projectetion into WA SPS projected WKT.
	 * @returns {string}
	 */
	function getProjectedMultiLinestring(/**{(Polyline|Polygon)}*/ g, inPrj, outPrj) {
		var output;
		output = getProjectedTerraformerPrimitive(g, inPrj, outPrj);
		output = Terraformer.WKT.convert(output);
		return output;
	}

	/**
	 * Converts an ArcGIS JS API geometry in the Web Merc. Aux. Sphere projectetion into WA SPS projected WKT.
	 * @returns {string}
	 */
	function getProjectedWkt(/** {Geometry} */ g) {
		var projected;
		if (g.x) {
			projected = proj4(mapPrj, waPrj, [g.x, g.y]);
			projected = ["POINT (", projected.join(" "), ")"].join("");
		} else if (g.paths) {
			projected = getProjectedMultiLinestring(g);
		}

		return projected;
	}

	/** @typedef {Object} CiaRoute
	 * @property {string} wkt - The route geometry in OGC Simple Geometry, in 2927 projection.
	 * @property {string} name - The route's name.
	 */

	/** Converts a CIA route into a graphic.
	 * @param {CiaRoute} ciaRoute
	 * @returns {Graphic}
	 */
	function ciaRouteToFeature(ciaRoute) {
		if (!ciaRoute.wkt || !ciaRoute.name) {
			throw new TypeError("Invalid route. Must have both wkt and name properties.");
		}
		var wkt = ciaRoute.wkt, name = ciaRoute.name;
		// Convert the WKT into a Terraformer geometry (i.e., representation of GeoJSON).
		var tfObj = Terraformer.WKT.parse(wkt);
		var projectedCoords = projectCoords(tfObj.coordinates, waPrj, mapPrj);
		var geometry = new Polyline({
			paths: projectedCoords,
			spatialReference: map.spatialReference
		});
		var graphic = new Graphic({
			geometry: geometry,
			attributes: {
				"Name": name
			}
		});

		return graphic;
	}

	/** Get routes from the data-routes attribute
	 * @returns {(Graphic[]|null)} Returns an array of Graphics if a data-routes attribute is provided, null otherwise.
	 */
	function getRoutes() {
		var output, json = window.frameElement.dataset ? window.frameElement.dataset.routes || null
			: window.frameElement.getAttribute("data-routes") || null;
		if (json) {
			output = JSON.parse(json, function (k, v) {
				return v && v.wkt && v.name ? ciaRouteToFeature(v) : v;
			});
		}

		return output;
	}

	/** 
	 * Gets the maximum number of routes that can be added to the map, 
	 * as determined by the data-route-limit attribute.
	 * @returns {(number|null)}
	 */
	function getRouteLimit() {
		var routeLimit;
		if (window.frameElement.dataset) {
			routeLimit = Number(window.frameElement.dataset.routeLimit) || null;
		} else {
			routeLimit = Number(window.frameElement.getAttribute("data-route-limit")) || null;
		}
		return routeLimit;
	}

	/** Determines if any more routes are allowed to be added to the map.
	 * If no data-route-limit attribute has been specified, this always returns false.
	 * @returns {boolean}
	 */
	function hasExceededRouteLimit() {
		var output, routeLimit = getRouteLimit();
		if (!routeLimit) {
			output = false;
		} else {
			output = routesLayer.graphics.length >= routeLimit;
		}
		return output;
	}

	/**
	 * Gets the extent from the iframe's data-extent attribute (if it exists).
	 * @returns {(Extent|null)} Return the extent if one exists, null otherwise.
	 */
	function getExtentFromDataAttribute() {
		var extent;
		if (window.frameElement) {
			if (window.frameElement.dataset) {
				extent = window.frameElement.dataset.extent;
			} else {
				extent = window.frameElement.getAttribute("data-extent");
			}
		}
		if (extent) {
			// Split at commas into separate numbers.
			extent = extent.split(",").map(function (v) { return Number(v); });
			extent = new Extent(extent[0], extent[1], extent[2], extent[3], new SpatialReference({ wkid: 3857 }));
		}
		return extent;
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

	/** Disables the clear and delete buttons of there are no graphics in the map.
	 */
	function setDisabledStatusOfButtons() {
		var deleteButton = document.getElementById("deleteButton"), clearButton = document.getElementById("clearButton");
		deleteButton.disabled = clearButton.disabled = !(stopsLayer.graphics.length > 0 || routesLayer.graphics.length > 0);
	}

	/** @callback {LayerGraphicEvent}
	 * @property {Graphic} graphic
	 * @property {GraphicsLayer} target
	 */

	/** Posts a message to the parent window
	 * @param {LayerGraphicEvent} e
	 * @param {string} action
	 */
	function postGraphicMessage(e, action) {
		var message = {
			layerId: e.target.id,
			action: action,
			graphic: e.graphic.toJson()
		};
		message.name = e.graphic.attributes.Name;
		message.wkt = getProjectedWkt(message.graphic.geometry);
		window.parent.postMessage(message, [location.protocol, location.host].join("//"));
	}

	/** Posts a message to the parent window
	 * @param {LayerGraphicEvent} e
	 */
	function postGraphicAddMessage(e) {
		postGraphicMessage(e, "added");
	}

	/** Posts a message to the parent window
	 * @param {LayerGraphicEvent} e
	 */
	function postGraphicRemoveMessage(e) {
		postGraphicMessage(e, "removed");
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
	 * @param {MouseEvent} e
	 * @param {HTMLButtonElement} e.target
	 */
	function deleteStopOrRoute(e) {
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

	/** Returns the first graphic from a layer with an attribute that has a specific value.
	 * @param {GraphicsLayer} layer
	 * @param {string} attrName
	 * @param {string} value
	 * @returns {Graphic}
	 */
	function getGraphicWithMatchingAttribute(layer, attrName, value) {
		var output = null, graphic, i, l;
		if (!layer || !attrName) {
			throw new TypeError("The layer and attrName parameters cannot be null.");
		}
		for (i = 0, l = layer.graphics.length; i < l; i += 1) {
			graphic = layer.graphics[i];
			if (graphic.attributes[attrName] === value) {
				output = graphic;
				break;
			}
		}
		return output;
	}

	/** Removes first graphic from the routes layer with a matching name.
	 * @param {string} name
	 * @returns {Graphic}
	 */
	function deleteGraphicWithMatchingName(name) {
		var graphic;
		if (routesLayer) {
			graphic = getGraphicWithMatchingAttribute(routesLayer, "Name", name);
			if (graphic) {
				routesLayer.remove(graphic);
			}
		}
		return graphic;
	}

	document.getElementById("deleteButton").addEventListener("click", deleteStopOrRoute);
	document.getElementById("clearButton").addEventListener("click", deleteStopOrRoute);


	// Set the routing URL to use a proxy.  The proxy will handle getting tokens.
	urlUtils.addProxyRule({
		proxyUrl: "proxy.ashx",
		urlPrefix: protocol + "//route.arcgis.com"
	});

	/**
	 * Creates the map options object for the Map constructor.
	 * @returns {Object}
	 */
	function createMapOptions() {
		var options = {
			basemap: new Basemap({
				id: "Hybrid",
				layers: [
					new BasemapLayer({ url: protocol + "//services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" }),
					new BasemapLayer({ url: protocol + "//services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer" }),
					new BasemapLayer({ url: protocol + "//services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer" })
				]
			}),
			showAttribution: true

		};
		var extent = getExtentFromDataAttribute();
		if (extent) {
			options.extent = extent;
		} else {
			options.center = [-120.80566406246835, 47.41322033015946];
			options.zoom = 7;
		}


		return options;
	}

	// Create the map.
	map = new Map("map", createMapOptions());

	map.on("extent-change", function (e) { console.log(e); });


	// Setup events to show a progress bar when the map is updating.
	connect.connect(map, "onUpdateStart", function () {
		document.getElementById("mapProgress").style.visibility = "";
	});

	connect.connect(map, "onUpdateEnd", function () {
		document.getElementById("mapProgress").style.visibility = "hidden";
	});

	/** Performs an action based on a message passed to the window from a parent.
	 * @param {MessageEvent} e
	 * @param {Object} e.data
	 * @param {string} e.data.action - The action name. E.g., "delete"
	 * @param {string} e.data.name - The name of the route. E.g., "Hewitt Ave & 20th St SE, Lake Stevens, Washington  98258 - Hewitt Ave & 20th St SE, Lake Stevens, Washington  98258"
	 * @param {string} [e.data.wkt] - The 2927 Simple Geometry WKT of the route. This property will only be present if action is "add".
	 */
	function handleRouteMessage(e) {
		var data = e.data, graphic, extent;
		if (data.action === "delete") {
			deleteGraphicWithMatchingName(data.name);
		} else if (data.action === "add") {
			try {
				graphic = ciaRouteToFeature(e.data);
				routesLayer.add(graphic);
				// Zoom the map to the graphic
				extent = graphic.geometry.getExtent();
				map.setExtent(extent);
			} catch (err) {
				window.parent.postMessage({
					error: err.message,
					sourceMessage: e.data
				}, [location.protocol, location.host].join("//"));
			}
		}
	}

	// Add an event handler for messages passed to this window while hosted in an iframe from the parent window.
	window.addEventListener("message", handleRouteMessage);

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

		/**
		 * @typedef {Object} esri.tasks.RouteResult
		 * @property {Graphic} route
		 * @property {string} routeName
		 */

		/**
		 * @typedef {Object.<string,Array>} SolveResults
		 * @property {Array} barriers
		 * @property {Array} messages
		 * @property {Array} polygonBarriers
		 * @property {Array} polylineBarriers
		 * @property {esri.tasks.RouteResult[]} routeResults
		 */

		/**
		 * @param {SolveResults} solveResults
		*/
		function solveHandler(solveResults) {
			var i, l, route;
			if (solveResults && solveResults.routeResults && solveResults.routeResults.length) {
				for (i = 0, l = solveResults.routeResults.length; i < l; i += 1) {
					route = solveResults.routeResults[i].route;
					if (route.attributes.Name) {
						route.attributes.Name = reduceRouteName(route.attributes.Name);
					}
					routesLayer.add(route);
				}
			}

			stopsLayer.clear();
		}

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

				routeTask.solve(routeParams, solveHandler, function (error) {
					window.console.error(error);
				});
			}
		});

		// Add any predefined routes.
		var routes = getRoutes();
		if (routes) {
			routes.forEach(function (v) {
				routesLayer.add(v);
			});
		}
	});
});