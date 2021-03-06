using System;
using System.Configuration;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.Serialization;
using System.Text.RegularExpressions;
using System.Web;
using System.Web.Caching;
using System.Xml.Serialization;
using Newtonsoft.Json;

namespace Proxy
{
	enum TokenRequestType
	{
		None = 0,
		User,
		OAuth
	}

	[XmlRoot("ProxyConfig")]
	public class ProxyConfig
	{
		#region Static Members

		private static object _lockobject = new object();

		public static ProxyConfig LoadProxyConfig(string fileName)
		{
			ProxyConfig config = null;

			lock (_lockobject)
			{
				if (File.Exists(fileName))
				{
					XmlSerializer reader = new XmlSerializer(typeof(ProxyConfig));
					using (var file = new StreamReader(fileName))
					{
						config = (ProxyConfig)reader.Deserialize(file);
					}
				}
			}

			return config;
		}

		public static ProxyConfig GetCurrentConfig()
		{
			ProxyConfig config = HttpRuntime.Cache["proxyConfig"] as ProxyConfig;
			if (config == null)
			{
				string fileName = GetFilename(HttpContext.Current);
				config = LoadProxyConfig(fileName);

				if (config != null)
				{
					CacheDependency dep = new CacheDependency(fileName);
					HttpRuntime.Cache.Insert("proxyConfig", config, dep);
				}
			}

			return config;
		}

		public static string GetFilename(HttpContext context)
		{
			return context.Server.MapPath("~/proxy.config");
		}
		#endregion

		ServerUrl[] serverUrls;
		bool mustMatch;

		[XmlArray("serverUrls")]
		[XmlArrayItem("serverUrl")]
		public ServerUrl[] ServerUrls
		{
			get { return this.serverUrls; }
			set { this.serverUrls = value; }
		}

		[XmlAttribute("mustMatch")]
		public bool MustMatch
		{
			get { return mustMatch; }
			set { mustMatch = value; }
		}

		private static TokenRequestType GetTokenRequestType(string userName, string password, string clientId, string clientSecret)
		{
			return !string.IsNullOrEmpty(userName) && !string.IsNullOrEmpty(password) ? TokenRequestType.User
				: !string.IsNullOrEmpty(clientId) && !string.IsNullOrEmpty(clientSecret) ? TokenRequestType.OAuth
				: TokenRequestType.None;
		}

		/// <summary>
		/// Creates the token request URL.
		/// </summary>
		/// <param name="userName">User name</param>
		/// <param name="password">password</param>
		/// <param name="expires">Number of minutes until the token will expire</param>
		/// <returns>Returns a <see cref="Uri"/>.</returns>
		private static Uri CreateTokenRequestUrl(string userName, string password, string clientId, string clientSecret, out TokenRequestType requestType, int? expires=default(int?))
		{
			requestType = GetTokenRequestType(userName, password, clientId, clientSecret);

			if (requestType == TokenRequestType.None)
			{
				throw new ArgumentNullException("None of the following parameters should be null: userName, password.", default(Exception));
			}

			// Get the requesting URL. The query string portion will be removed.
			string referrer = Regex.Match(HttpContext.Current.Request.Url.ToString(), @"[^\?]+").Value;

			string url;

			if (requestType == TokenRequestType.User)
			{
				const string _tokenUrl = "https://www.arcgis.com/sharing/generateToken?username={0}&password={1}&referer={2}&expiration={3}&f=json";
				url = string.Format(_tokenUrl, userName, password, referrer, expires.HasValue ? expires.ToString() : string.Empty);

			}
			else
			{
				const string _tokenUrl = "https://www.arcgis.com/sharing/oauth2/token?client_id={0}&grant_type=client_credentials&client_secret={1}&f=json";
				url = string.Format(_tokenUrl, clientId, clientSecret, referrer, expires.HasValue ? expires.ToString() : string.Empty);
			}



			return new Uri(url);
		}

		/// <summary>
		/// Gets the token for the specified service URI.
		/// </summary>
		/// <param name="uri"></param>
		/// <returns>
		/// Returns the token.  Could return an empty string if there are no 
		/// matching URIs in proxy.config and "mustMatch" is set to "false".
		/// </returns>
		/// <exception cref="InvalidOperationException">
		/// Raised if there is no matching URI in proxy.config and "mustMatch" is set to "true".
		/// </exception>
		public string GetToken(string uri)
		{
#if DEBUG
			Trace.TraceInformation("Entering GetToken(\"{0}\") method...", uri); 
#endif
			string agolUser, agolPW, agolClientId, agolClientSecret;
			agolUser = ConfigurationManager.AppSettings["agolUser"];
			agolPW = ConfigurationManager.AppSettings["agolPassword"];
			agolClientId = ConfigurationManager.AppSettings["agolClientId"];
			agolClientSecret = ConfigurationManager.AppSettings["agolClientSecret"];

			Trace.TraceInformation("{0}:{1}", agolUser, agolPW);

			string token = string.Empty;

			foreach (ServerUrl su in serverUrls)
			{
				if (su.MatchAll && uri.StartsWith(su.Url, StringComparison.InvariantCultureIgnoreCase))
				{
#if DEBUG
					Trace.TraceInformation("URI partial match found: {0} matches {1}.", su.Url, uri); 
#endif
					token = su.DynamicToken ? GetTokenForUrl(agolUser, agolPW, agolClientId, agolClientSecret, su) : su.Token;
					break;
				}
				else
				{
					if (String.Compare(uri, su.Url, StringComparison.InvariantCultureIgnoreCase) == 0)
					{
#if DEBUG
						Trace.TraceInformation("URI match found: {0} matches {1}.", su.Url, uri); 
#endif
						token = su.DynamicToken ? GetTokenForUrl(agolUser, agolPW, agolClientId, agolClientSecret, su) : su.Token;
						break;
					}
				}
			}

			if (string.IsNullOrEmpty(token) && mustMatch)
			{
				const string msg = "The \"mustMatch\" option is specified in proxy.config, but no matching URLs were found.";
#if DEBUG
				Trace.TraceError(msg); 
#endif
				throw new InvalidOperationException(msg);
			}

			return token;
		}

		private static string GetTokenForUrl(string agolUser, string agolPW, string agolClientId, string agolClientSecret, ServerUrl su)
		{
			// If the URL has the dynamic token attribute set to true,
			// create a new token if there is no current token or if the 
			// current token is expired.
			if (su.Token == null || su.TokenHasExpired)
			{
				TokenRequestType tokenRequestType;

				var url = CreateTokenRequestUrl(agolUser, agolPW, agolClientId, agolClientSecret, out tokenRequestType);
#if DEBUG
				Trace.TraceInformation("Requesting token from \"{0}\"...", url);
#endif

				// Get a new token.
				var request = WebRequest.Create(url);
				string json;
				using (var response = request.GetResponse())
				{
					using (var stream = response.GetResponseStream())
					{
						using (var reader = new StreamReader(stream))
						{
							json = reader.ReadToEnd();
						}
					}
				}
#if DEBUG
				Trace.TraceInformation("Response from token request: {0}", json);
#endif
				try
				{
					if (tokenRequestType == TokenRequestType.OAuth)
					{
						OAuthToken token;
						token = JsonConvert.DeserializeObject<OAuthToken>(json, new IntToDateConverter());
						// Set the server URL properties corresponding to the token.
						su.Token = token.AccessToken;
						su.TokenExpires = token.Expires;
					}
					else
					{
						Token token;
						token = JsonConvert.DeserializeObject<Token>(json, new IntToDateConverter());
						// Set the server URL properties corresponding to the token.
						su.Token = token.token;
						su.TokenExpires = token.expires;
					}
				}
				catch (JsonException ex)
				{
#if DEBUG
					Trace.TraceError("{0}", ex);
#endif

					throw;
				}
			}
			return su.Token;
		}
	}
}