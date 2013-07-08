using System;
using System.Collections.Generic;
using System.Configuration;
using System.Linq;
using System.Text.RegularExpressions;
using System.Web;
using System.Web.Script.Serialization;
using Esri.ArcGis.Soap;
using Wsdot.Gis;

namespace ArcGisSecureServicesTest
{
	/// <summary>
	/// <para>REST Endpoint for the ESRI SOAP SDK ReverseGeocode operation.</para>
	/// <para>location: A point defined by two <see cref="double"/> values separated by a string.</para>
	/// </summary>
	/// <remarks>
	/// The reason you would use this handler instead of just using the ArcGIS 
	/// REST API reverse geocode method is that the REST version does not
	/// provide the ability to return intersections.
	/// </remarks>
	public class ReverseGeocodeIntersection : IHttpHandler
	{
		static readonly Regex _distanceRegex = new Regex(@"(?in)(?<number>\d+(\.\d+)?)(\s*(?<unit>\w+))?");
		const string _defaultUnits = "Meters";

		static Dictionary<string, object> ToJsonPoint(PointN point)
		{
			if (point == null) return null;

			var output = new Dictionary<string, object>();
			output["x"] = point.X;
			output["y"] = point.Y;
			var srDict = ToJsonSR(point.SpatialReference);
			if (srDict != null)
			{
				output["spatialReference"] = srDict;
			}

			return output;
		}

		static Dictionary<string, object> ToJsonSR(SpatialReference sr)
		{
			if (sr.WKIDSpecified)
			{
				var output = new Dictionary<string, object>();
				output.Add("wkid", sr.WKID);
				return output;
			}
			return null;
		}

		static bool TryParse(string locationString, out PointN point)
		{
			point = null;
			if (string.IsNullOrEmpty(locationString))
			{
				return false;
			}
			// Try to split coordinates
			var coordStrings = locationString.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
			if (coordStrings.Length < 2)
			{
				return false;
			}

			point = new PointN();
			bool fail = false;
			for (int i = 0; i < 2; i++)
			{
				double coord;
				if (double.TryParse(coordStrings[i], out coord))
				{
					if (i == 0)
					{
						point.X = coord;
					}
					else if (i == 1)
					{
						point.Y = coord;
					}
				}
				else
				{
					fail = true;
					break;
				}
			}


			return !fail;
		}

		static void GetDistance(string distanceString, out double distance, out string units)
		{
			var match = _distanceRegex.Match(distanceString);
			if (!match.Success)
			{
				units = _defaultUnits;
				distance = 0;
			}
			else
			{
				double number;
				if (!double.TryParse(match.Groups["number"].Value, out number))
				{
					number = 0;
				}
				distance = number;
				var unitGroup = match.Groups["unit"];
				units = unitGroup.Success ? unitGroup.Value : _defaultUnits;
			}
		}

		public void ProcessRequest(HttpContext context)
		{

			// location
			// f
			// distance (in meters)
			// outSR

			PointN point;
			if (!TryParse(context.Request.Params["location"], out point))
			{
				// Exit with an error message if a location was not provided.
				context.Response.StatusCode = 400;
				context.Response.Write(string.Format("{{\"error\":\"{0}\"}}", "The location parameter was not provided."));
				context.Response.ContentType = "application/json";
				return;
			}

			// If an input spatial reference has been specified, add that information to the point.
			string inSRStr = context.Request.Params["inSR"];
			int inSRWKT;
			if (!string.IsNullOrEmpty(inSRStr) && int.TryParse(inSRStr, out inSRWKT))
			{
				point.SpatialReference = inSRWKT.ToSpatialReference();
			}

			string outSRStr = context.Request.Params["outSR"];
			int outSRWKT;
			SpatialReference outSR = null;
			if (!string.IsNullOrEmpty(outSRStr) && int.TryParse(outSRStr, out outSRWKT))
			{
				outSR = outSRWKT.ToSpatialReference();
			}

			// Get the distance.
			string distanceStr = context.Request.Params["distance"];
			double distance = 0;
			string units = _defaultUnits;
			if (!string.IsNullOrEmpty(distanceStr))
			{
				GetDistance(distanceStr, out distance, out units);
			}

			PropertySet result;

			using (var proxy = new GeocodeServerProxy { Url = ConfigurationManager.AppSettings["GeocodeService"] })
			{
				// Get the default properties for this geocode server.
				PropertySet locatorProperties = proxy.GetLocatorProperties();

				// Convert the property set into a dictionary for easier editing/adding of properties.
				var lPropDict = locatorProperties.PropertyArray.ToDictionary(k => k.Key, v => v.Value);
				lPropDict["OutputSpatialReference"] = outSR;

				lPropDict["ReverseDistance"] = distance;
				lPropDict["ReverseDistanceUnits"] = units;

				// Convert the dictionary back into a property array.
				locatorProperties.PropertyArray = (from kvp in lPropDict
												   select new PropertySetProperty
												   {
													   Key = kvp.Key,
													   Value = kvp.Value
												   }).ToArray();

				result = proxy.ReverseGeocode(point, true, locatorProperties);
			}

			// Convert the property array into a dictionary.
			var output = new Dictionary<string, object>();
			if (result.PropertyArray != null && result.PropertyArray.Length > 0)
			{
				var resultProperties = result.PropertyArray.ToDictionary(k => k.Key, v => v.Value);

				output["address"] = (from prop in result.PropertyArray
									 where string.Compare(prop.Key, "Shape", true) != 0
									 select prop).ToDictionary(k => k.Key, v => v.Value);

				var location = resultProperties["Shape"] as PointN;
				if (location != null)
				{
					output["location"] = ToJsonPoint(location);
				}
			}





			var serializer = new JavaScriptSerializer();
			string json = serializer.Serialize(output);

			context.Response.ContentType = "application/json";
			context.Response.Write(json);
		}



		public bool IsReusable
		{
			get
			{
				return false;
			}
		}
	}
}