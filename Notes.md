Notes
=====

## regular expressions ##

### Match intersection address ###
	/([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s(\d+)/i


#### Example ####
Broadway Ave & Broadway, Everett, Washington 98201

### Match name of route between interections ###
	/(([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s(\d+))\s-\s(([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s(\d+))/i

Broadway Ave & Broadway, Everett, Washington 98201 - Walnut St & 19th St, Everett, Washington 98201

#### Both points have same state ###

	/(([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s(\d+))\s-\s(([^&]+)\s&\s+([^,]+),\s([^,]+),\s\5\s(\d+))/i

#### Both points have same state and ZIP ####
	/(([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s(\d+))\s-\s(([^&]+)\s&\s+([^,]+),\s([^,]+),\s\5\s\6)/i

#### Same city, state, and ZIP ####

	/(([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s(\d+))\s-\s(([^&]+)\s&\s+([^,]+),\s\4,\s\5\s\6)/i

### Route between intersections: Street and cross streets (same city, state, and ZIP) ###

	/(?:([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s(\d+))\s-\s(?:(?:([^&]+)\s&\s+\1,\s\3,\s\4\s\5)|(?:\1\s&\s+([^,]+),\s\3,\s\4\s\5)|(?:([^&]+)\s&\s+\2,\s\3,\s\4\s\5)|(?:\2\s&\s+([^,]+),\s\3,\s\4\s\5))/i

#### Commented [XRegExp] version (for clarity) ####

	(?:
		(?<street1>[^&]+) #street1
		\s&\s+
		(?<street2>[^,]+) #street2
		,\s
		(?<city>[^,]+) #city
		,\s
		(?<state>[a-z]+) #state
		\s+
		(?<zip>\d+) #zip
	)
	\s-\s # Separator between intersections
	(?:
		(?:([^&]+)(?#other cross street)\s&\s+${street1},\s${city},\s${state}\s+${zip}) 
		# capture 6 is the other cross street - if not undefined then street1 is the main street
		|
		(?:${street1}\s&\s+([^,]+)(?#other cross street),\s${city},\s${state}\s+${zip}) 
		# capture 7 is the other cross street - if not undefined then street1 is the main street
		|
		(?:([^&]+)(?#other cross street)\s&\s+${street2},\s${city},\s${state}\s+${zip}) 
		# capture 8 is the other cross street - if not undefined then street2 is the main street
		|
		(?:${street2}\s&\s+([^,]+)(?#other cross street),\s${city},\s${state}\s+${zip}) 
		# capture 9 is the other cross street - if not undefined then street2 is the main street
	)

or

	/^(?:([^&]+)\s&\s+([^,]+),\s([^,]+),\s([a-z]+)\s(\d+))\s-\s(?:(?:([^&]+)\s&\s+\1,\s\3,\s\4\s\5)|(?:\1\s&\s+([^,]+),\s\3,\s\4\s\5)|(?:([^&]+)\s&\s+\2,\s\3,\s\4\s\5)|(?:\2\s&\s+([^,]+),\s\3,\s\4\s\5))$/img

#### Captures ####

1. Street 1
2. Street 2
3. City
4. State
5. ZIP
6. End street if 1 & 4 match, otherwise undefined (Main street is `match[1]`, cross streets are `match[2]` and `match[6]`)
7. End street if 2 & 4 match, otherwise undefined (Main street is `match[1]`, cross streets are `match[2]` and `match[7]`)
8. End street if 2 & 3 match, otherwise undefined (Main street is `match[2]`, cross streets are `match[1]` and `match[8]`)
9. End street if 1 & 3 match, otherwise undefined (Main street is `match[2]`, cross streets are `match[1]` and `match[9]`)

#### Examples ####
Matches *any* of the following:

* **Walnut St** & 19th St, Everett, Washington 98201 - 18th St & **Walnut St**, Everett, Washington 98201
* 19th St & **Walnut St**, Everett, Washington 98201 - 18th St & **Walnut St**, Everett, Washington 98201
* 19th St & **Walnut St**, Everett, Washington 98201 - **Walnut St** & 18th St, Everett, Washington 98201
* **Walnut St** & 19th St, Everett, Washington 98201 - **Walnut St** & 18th St, Everett, Washington 98201

[XRegExp]:http://www.xregexp.com/