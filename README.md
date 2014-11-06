# CIA Local Roads Selector #

Developed for the WSDOT Construction Impact Analysis (CIA) application, this control that can be used to select a road segment between two intersections.

For background on why the control is structured in this way (i.e., a separate page inside of an `iframe`) see the [ArcGIS-JS-with-AJAX-Control-Toolkit] project documentation.

## Getting started ##

In order to run this application you will need to [create OAuth Credentials] to access Esri's secure services. Once you have done this, perform the following steps.

1. Create a copy of `Sample.Web.Config` and call it `Web.Config`.
2. Provide values for the `agolClientId` and `agolClientSecret` settings in `Web.Config`.

The `Web.Config` file is ignored by the repository to avoid sensitive information being commited to this publicly-accessible repository.

## Components ##

### routeLocator.html ###

This is the route locator control. You place it into another page using an `iframe` element.

#### `data-` attributes ####

The route locator can be controlled and restricted by applying certain `data-` attributes to its `iframe` container element.

* `data-extent`: Allows an initial extent for the map to be specified using a comma-separated list of four numbers: xmin, ymin, xmax, ymax.
* `data-routes`: A list of routes that will be shown in the map when it is created.
* `data-route-limit`: Setting this value to a number will make it so that no more than this number of routes can be added to the map.

##### Example ####
```html
<iframe id="defaultFunctionality" src="../routeLocator.html"
	data-route-limit="1"
	data-extent='-13603483.591966238,6105001.562563945,-13601954.851400495,6106148.117988253'
	data-routes='[{"name":"Broadway Ave & Broadway, Everett, Washington 98201 - Walnut St & 19th St, Everett, Washington 98201","wkt":"MULTILINESTRING ((1223777.0363041605 974286.4877257114, 1223938.2201941456 974283.0113976741, 1224134.034042777 974275.140388624, 1224479.1379762676 974260.4061769943, 1224824.3207971738 974249.3260509287, 1225166.9767772476 974234.6568145567, 1225355.4455387671 974226.9561179036, 1225678.5910221795 974216.3648643482, 1226026.1452692528 974201.6057042377, 1226363.9833899096 974190.7107014619, 1226613.66964021 974181.7100350896, 1226711.538362319 974175.9640899752, 1226712.4934973922 974175.9041382241))"}]'></iframe>
```

#### Communicating with the `iframe` ###

Routes can be added or removed from the route locator by posting messages to the `iframe`.

##### Adding a route #####

```javascript
var name = "Broadway Ave from 17th St to Broadway, Everett, Washington 98201";
var wkt = "MULTILINESTRING ((1223777.0363042844 974286.4877314497, 1223938.2201942692 974283.0114034093, 1224134.034042901 974275.1403943684, 1224479.137976391 974260.4061827295, 1224824.3207972972 974249.3260566639, 1225166.9767773708 974234.6568202889, 1225355.44553889 974226.9561236326, 1225678.5910223026 974216.3648700896, 1226026.145269376 974201.605709979, 1226363.9833900325 974190.7107071971, 1226613.669640333 974181.7100408279, 1226711.5383624418 974175.9640957135, 1226712.493497515 974175.9041439623))";
window.frames[0].postMessage({
	action: "add",
	name: name,
	wkt: wkt
}, [location.protocol, location.host].join("//"));
```

##### Removing a route #####

```javascript
var name = "Broadway Ave from 17th St to Broadway, Everett, Washington 98201";
window.frames[0].postMessage({
	action: "delete",
	name: routeName
}, [location.protocol, location.host].join("//"));
```
##### Responding to messages from the `iframe` #####

When a route is added or removed from the map a `message` event is set to the host window.
When adding an event listener, the callback function will take a MessageEvent argument.
This argument will contain a data property. The data property will contain these properties...

* `action`: Will be "added" if routes were added or "removed" if routes were removed.
* `name`: The name of the route
* `wkt`: The route geometry in OGC Simple Geometry format.
* `layerId`: The layer that had graphics added or removed. E.g., "routes"

```javascript
window.addEventListener("message", function (/** {MessageEvent} */ e) {
	var table, row, cell, deleteButton;
	if (e.data.layerId === "routes") {
		table = document.getElementById("routeTable");
		if (e.data.action === "added") {
			// Add a row to the table for the added route.
			row = document.createElement("tr");
			//row.dataset.routeName = e.data.name;
			row.setAttribute("data-route-name", e.data.name);

			cell = row.insertCell(-1);
			cell.textContent = e.data.name;
			cell = row.insertCell(-1);
			// Create a button that, when clicked, will delete the corresponding route in the map.
			deleteButton = document.createElement("button");
			deleteButton.type = "button";
			deleteButton.value = e.data.name;
			deleteButton.textContent = "Delete";
			deleteButton.addEventListener("click", sendRouteDeleteMessage, true);
			cell.appendChild(deleteButton);

			cell = row.insertCell(-1);
			cell.textContent = e.data.wkt;

			table.querySelector("tbody").appendChild(row);
		} else if (e.data.action === "removed") {
			// Remove the row from the table corresponding to the removed route.
			row = document.querySelector("tr[data-route-name='" + e.data.name + "']");
			row.parentNode.removeChild(row);
		}
	}
});
```

### ReverseGeocodeIntersection.ashx ###

This provides a REST endpoint for finding an intersection using reverse geocode. This feature is lacking from the ArcGIS REST API, so the ArcGIS SOAP API is called by this handler.

### proxy.ashx ###

This proxy is used to get ArcGIS REST resources. This handles the retrieval of tokens so that none of this information is revealed client-side.

## Development environment ##

This project was created in Visual Studio 2013.

[create OAuth Credentials]:http://resources.arcgis.com/en/help/arcgis-rest-api/#/Accessing_services_provided_by_Esri/02r300000268000000/
[ArcGIS-JS-with-AJAX-Control-Toolkit]:https://github.com/WSDOT-GIS/ArcGIS-JS-with-AJAX-Control-Toolkit
