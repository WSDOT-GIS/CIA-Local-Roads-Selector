/*global require*/
/*jslint browser:true, white:true, regexp:true*/
require([
	"dojo/on",
	// "dojo/aspect",
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
	"wsdot/tasks/intersectionLocator",
	"dojo/store/Memory", "dojo/store/Observable", "dijit/tree/ObjectStoreModel", "dijit/Tree",
	"dojo/domReady!"],
	function (on, /*aspect,*/ BorderContainer, ContentPane, urlUtils, Map, Point, GraphicsLayer, RouteTask, SimpleRenderer, SimpleMarkerSymbol,
		SimpleLineSymbol, Graphic, InfoTemplate, Basemap, BasemapLayer,
		RouteParameters, FeatureSet, Units,
		IntersectionLocator,
		Memory, Observable, ObjectStoreModel, Tree) {
		"use strict";
		var map, locator, routeTask, stopsLayer, routesLayer, protocol, routesStore, routesModel, tree;

		/** Converts the route name returned from the route task to a shorter name, omitting city, state, and ZIP info.
		 * @param {String} routeName E.g., "State Ave NW & Capitol Way N, Olympia, WA  98501 - State Ave NE & Adams St NE, Olympia, WA  98501"
		 * @returns {String}
		 */
		function createName(routeName) {
			var r = /([^&]+)\s+&\s+([^&,]+),\s+.+\d+\s+\-\s+([^&]+)\s+&\s+([^&,]+),\s+.+\s*\d+/, m, start1, start2, end1, end2, output;
			m = routeName.match(r);
			if (m) {
				start1 = m[1];
				start2 = m[2];
				end1 = m[3];
				end2 = m[4];

				if (start1 === end1) {
					output = [start1, "from", start2, "to", end2].join(" ");
				} else if (start1 === end2) {
					output = [start1, "from", start2, "to", end1].join(" ");

				} else if (start2 === end1) {
					output = [start2, "from", start1, "to", end2].join(" ");

				} else if (start2 === end2) {
					output = [start2, "from", start1, "to", end1].join(" ");

				} else {
					output = [start1, "&", start2, "-", end1, "&", end2].join(" ");
				}

				return output;
			}
		}

		routesStore = new Memory({
			data: [{
				id: "root",
				name: "routes"
			}],
			getChildren: function (object) {
				// Add a getChildren() method to store for the data model where
				// children objects point to their parent (aka relational model)
				return this.query({ parent: object.id });
			}
		});



		routesStore = new Observable(routesStore);

		routesModel = new ObjectStoreModel({
			store: routesStore
		});

		////aspect.after(routesModel, "onChange", function (item) {
		////	console.debug("change", item);
		////});

		////aspect.after(routesModel, "onChildrenChange", function (parent, newChildrenList) {
		////	console.debug("children-change", {
		////		parent: parent,
		////		newChildrenList: newChildrenList
		////	});
		////});

		/** Sets up the border container layout for the page.
		 */
		function setupBorderContainer() {
			var bc, mapPane, listPane, listContainer, treePane, treeToolsPane;

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

			listContainer = new BorderContainer({
				design: "headline",
				gutters: false
			}, "listContainer");

			treePane = new ContentPane({
				region: "center"
			}, "treePane");
			listContainer.addChild(treePane);

			treeToolsPane = new ContentPane({
				region: "bottom"
			}, "treeToolsPane");
			listContainer.addChild(treeToolsPane);

			listContainer.startup();
			
			tree = new Tree({
				id: "routesTree",
				model: routesModel
			}, "tree");

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

		map.on("update-start", function () {
			document.getElementById("mapProgress").hidden = false;
		});

		map.on("update-end", function () {
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

			//// DEBUG
			//window.stopsLayer = stopsLayer;

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

			//// DEBUG
			//window.routesLayer = routesLayer;

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

								// Add item to the store for the route.
								routesStore.add({
									id: routeGraphic.attributes.Name,
									name: createName(routeGraphic.attributes.Name),
									graphic: routeGraphic,
									parent: "root"
								});
							}
						}

						stopsLayer.clear();
						//window.console.log(solveResults);
					}, routeParams, function (error) {
						if (window.console) {
							window.console.error(error);
						}
					});
				}
			});

			on(document.getElementById("deleteButton"), "click", function () {
				var selectedItems, item, i, l, idsToRemove = [], id;

				selectedItems = tree.selectedItems;

				// Create a list of IDs to remove.
				for (i = 0, l = selectedItems.length; i < l; i += 1) {
					item = selectedItems[i];
					if (item.id !== "root") {
						idsToRemove.push(item.id);
						// Delete the associated graphic.
						routesLayer.remove(item.graphic);
					}
				}

				// Remove the IDs.
				for (i = 0, l = idsToRemove.length; i < l; i += 1) {
					id = idsToRemove[i];
					routesStore.remove(id);
				}
				
			});
		});
	});