/*
  This proxy page does not have any security checks. It is highly recommended
  that a user deploying this proxy page on their web server, add appropriate
  security checks, for example checking request path, username/password, target
  url, etc.
*/
using System;
using System.Configuration;
using System.IO;
using System.Net;
using System.Web;
using System.Web.Caching;
using System.Xml.Serialization;
using SS = ServiceStack.Text;

namespace Proxy
{

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
				if (System.IO.File.Exists(fileName))
				{
					XmlSerializer reader = new XmlSerializer(typeof(ProxyConfig));
					using (System.IO.StreamReader file = new System.IO.StreamReader(fileName))
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

		private static Uri CreateTokenRequestUrl(string userName, string password, int? expires=default(int?))
		{
			
			if (string.IsNullOrEmpty(userName) || string.IsNullOrEmpty(password))
			{
				throw new ArgumentNullException("None of the following parameters should be null: userName, password, or referrer.", default(Exception));
			}
			string referrer = HttpContext.Current.Request.Url.ToString();
			const string _tokenUrl = "https://www.arcgis.com/sharing/generateToken?username={0}&password={1}&referer={2}&expiration={3}&f=json";

			string url = string.Format(_tokenUrl, userName, password, referrer, expires.HasValue ? expires.ToString() : string.Empty);

			return new Uri(url);
		}

		public string GetToken(string uri)
		{
			string agolUser, agolPW;
			agolUser = ConfigurationManager.AppSettings["agolUser"];
			agolPW = ConfigurationManager.AppSettings["agolPassword"];

			foreach (ServerUrl su in serverUrls)
			{
				if (
					(su.MatchAll && uri.StartsWith(su.Url, StringComparison.InvariantCultureIgnoreCase)) 
					|| String.Compare(uri, su.Url, StringComparison.InvariantCultureIgnoreCase) == 0)
				{
					
					if (su.DynamicToken)
					{
						// If the URL has the dynamic token attribute set to true,
						// create a new token if there is no current token or if the 
						// current token is expired.
						if (su.Token == null || su.TokenExpired)
						{
							var url = CreateTokenRequestUrl(agolUser, agolPW);

							// Get a new token.
							var request = WebRequest.Create(url);
							Token token;
							using (var response = request.GetResponse())
							{
								using (var stream = response.GetResponseStream())
								{
									var serializer = new SS.JsonSerializer<Token>();
									using (var reader = new StreamReader(stream))
									{
										token = serializer.DeserializeFromReader(reader);
									}
								}
							}

							// Set the server URL properties corresponding to the token.
							su.Token = token.token;
							su.TokenExpires = token.expires;
						}
						return su.Token;
					}
					else
					{
						return su.Token;
					}
				}
			}

			if (mustMatch)
			{
				throw new InvalidOperationException("The \"mustMatch\" option is specified in proxy.config, but no matching URLs were found.");
			}

			return string.Empty;
		}
	}
}