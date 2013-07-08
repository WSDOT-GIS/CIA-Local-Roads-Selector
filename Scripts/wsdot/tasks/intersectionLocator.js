/*global define*/
/*jslint nomen:true,white:true*/
define([
	"dojo/_base/declare",
	"esri/tasks/locator",
	"dojo/request",
	"esri/tasks/AddressCandidate",
	"esri/geometry/jsonUtils"
], function (declare, Locator, request, AddressCandidate, jsonUtils) {
	"use strict";

	/** Converts an object into an AddressCandidate.
	 * @param json
	 * @param json.address
	 * @param json.location A JSON object representing a Point.
	 * @returns {esri.tasks.AddressCandidate}
	 */
	function jsonToAddressCandidate(json) {
		var addressCandidate;

		addressCandidate = new AddressCandidate();
		addressCandidate.address = json.address;
		addressCandidate.location = jsonUtils.fromJson(json.location);
		return addressCandidate;
	}

	return declare(Locator, {

		/** Creates the intersectionLocator
		 * @param {String} url
		 * @constructs
		 */
		constructor: function (url) {
			// Base constructor is called automatically.
		},

		_emitIntersectionLocated: function (json) {
			var addressCandidate;
			addressCandidate = jsonToAddressCandidate(json);
			this.emit("location-to-intersection-complete", addressCandidate);
		},
		_emitIntersectionLocateError: function (error) {
			this.emit("location-to-intersection-error", error);
		},
		/** Locations an intersection based on a given point.
		* @param {esri/geometry/Point} location The point at which to search for the closest address. The location should be in the same spatial reference as that of the geocode service.
		* @param {Number} [distance] The distance in meters from the given location within which a matching address should be searched. If this parameter is not provided or an invalid value is provided, a default value of 0 meters is used.
		* @param {Function} [callback] The function to call when the method has completed. The arguments in the function are the same as the onLocationToAddressComplete event.
		* @param {Function} [errback] An error object is returned if an error occurs on the Server during task execution.
		* @returns {dojo/Deferred}
		*/
		locationToIntersection: function (location, distance, callback, errback) {
			var self = this, deferred, content;

			// Create content for request
			content = {
				location: [location.x, location.y].join(","),
				distance: distance || 0
			};
			if (location.spatialReference) {
				content.inSR = location.spatialReference.wkid;
			}

			// The outSpatialReference property is inherited from Locator.
			if (this.outSpatialReference) {
				content.outSR = this.outSpatialReference.wkid;
			}

			deferred = request(this.url, {
				query: content,
				handleAs: "json"
			});

			deferred.then(function (json) {
				if (callback) {
					callback(jsonToAddressCandidate(json));
				}
				self._emitIntersectionLocated(json);
			}, function (error) {
				if (errback) {
					errback(error);
				}
				self._emitIntersectionError(error);
			});


			return deferred;
		}
	});
});