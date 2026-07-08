/**
 * locations.js — Country + State/Region dataset
 * Used by the Wizard Step 3 (Location Picker)
 */

const COUNTRIES = [
  { code: 'US', name: 'United States', flag: '🇺🇸', states: ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'] },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', states: ['England','Scotland','Wales','Northern Ireland'] },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', states: ['Alberta','British Columbia','Manitoba','New Brunswick','Newfoundland and Labrador','Nova Scotia','Ontario','Prince Edward Island','Quebec','Saskatchewan'] },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', states: ['New South Wales','Victoria','Queensland','Western Australia','South Australia','Tasmania','Australian Capital Territory','Northern Territory'] },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', states: ['Abia','Adamawa','Akwa Ibom','Anambra','Bauchi','Bayelsa','Benue','Borno','Cross River','Delta','Ebonyi','Edo','Ekiti','Enugu','FCT Abuja','Gombe','Imo','Jigawa','Kaduna','Kano','Katsina','Kebbi','Kogi','Kwara','Lagos','Nasarawa','Niger','Ogun','Ondo','Osun','Oyo','Plateau','Rivers','Sokoto','Taraba','Yobe','Zamfara'] },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', states: ['Eastern Cape','Free State','Gauteng','KwaZulu-Natal','Limpopo','Mpumalanga','Northern Cape','North West','Western Cape'] },
  { code: 'IN', name: 'India', flag: '🇮🇳', states: ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi'] },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', states: ['Baden-Württemberg','Bavaria','Berlin','Brandenburg','Bremen','Hamburg','Hesse','Lower Saxony','Mecklenburg-Vorpommern','North Rhine-Westphalia','Rhineland-Palatinate','Saarland','Saxony','Saxony-Anhalt','Schleswig-Holstein','Thuringia'] },
  { code: 'FR', name: 'France', flag: '🇫🇷', states: ['Auvergne-Rhône-Alpes','Bourgogne-Franche-Comté','Bretagne','Centre-Val de Loire','Corse','Grand Est','Hauts-de-France','Île-de-France','Normandie','Nouvelle-Aquitaine','Occitanie','Pays de la Loire','Provence-Alpes-Côte d\'Azur'] },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', states: ['Acre','Alagoas','Amapá','Amazonas','Bahia','Ceará','Distrito Federal','Espírito Santo','Goiás','Maranhão','Mato Grosso','Mato Grosso do Sul','Minas Gerais','Pará','Paraíba','Paraná','Pernambuco','Piauí','Rio de Janeiro','Rio Grande do Norte','Rio Grande do Sul','Rondônia','Roraima','Santa Catarina','São Paulo','Sergipe','Tocantins'] },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', states: ['Aguascalientes','Baja California','Baja California Sur','Campeche','Chiapas','Chihuahua','Ciudad de México','Coahuila','Colima','Durango','Estado de México','Guanajuato','Guerrero','Hidalgo','Jalisco','Michoacán','Morelos','Nayarit','Nuevo León','Oaxaca','Puebla','Querétaro','Quintana Roo','San Luis Potosí','Sinaloa','Sonora','Tabasco','Tamaulipas','Tlaxcala','Veracruz','Yucatán','Zacatecas'] },
  { code: 'AE', name: 'UAE', flag: '🇦🇪', states: ['Abu Dhabi','Dubai','Sharjah','Ajman','Umm Al-Quwain','Ras Al Khaimah','Fujairah'] },
  { code: 'SA', name: 'Saudi Arabia', flag: '🇸🇦', states: ['Riyadh','Mecca','Medina','Eastern Province','Asir','Tabuk','Hail','Northern Borders','Jizan','Najran','Al Bahah','Al Jawf','Qassim'] },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', states: ['Nairobi','Mombasa','Kisumu','Nakuru','Eldoret','Thika','Malindi','Kitale','Garissa','Kakamega'] },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', states: ['Greater Accra','Ashanti','Western','Central','Eastern','Northern','Upper East','Upper West','Volta','Brong-Ahafo','Bono East','Ahafo','Bono','North East','Savannah','Oti','Western North'] },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', states: ['Metro Manila','Cebu','Davao','Central Luzon','Calabarzon','Western Visayas','Northern Mindanao','Southern Mindanao','Bicol','Ilocos'] },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', states: ['Central Region','North Region','North-East Region','East Region','West Region'] },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', states: ['Auckland','Wellington','Canterbury','Waikato','Bay of Plenty','Otago','Hawke\'s Bay','Manawatū-Whanganui','Southland','Taranaki'] },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', states: ['Tokyo','Osaka','Kanagawa','Aichi','Saitama','Chiba','Hyogo','Hokkaido','Fukuoka','Shizuoka'] },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', states: ['Lombardy','Lazio','Campania','Veneto','Emilia-Romagna','Piedmont','Apulia','Tuscany','Calabria','Sardinia'] },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', states: ['Andalusia','Catalonia','Community of Madrid','Valencian Community','Galicia','Castile and León','Basque Country','Aragon','Canary Islands','Castile-La Mancha'] },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷', states: ['Buenos Aires','Córdoba','Santa Fe','Mendoza','Tucumán','Entre Ríos','Salta','Chaco','Santiago del Estero','Misiones'] },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴', states: ['Bogotá','Antioquia','Valle del Cauca','Cundinamarca','Santander','Córdoba','Norte de Santander','Tolima','Bolívar','Nariño'] },
  { code: 'PK', name: 'Pakistan', flag: '🇵🇰', states: ['Punjab','Sindh','Khyber Pakhtunkhwa','Balochistan','Islamabad','Azad Kashmir','Gilgit-Baltistan'] },
  { code: 'BD', name: 'Bangladesh', flag: '🇧🇩', states: ['Dhaka','Chittagong','Rajshahi','Khulna','Sylhet','Barisal','Rangpur','Mymensingh'] },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬', states: ['Cairo','Alexandria','Giza','Port Said','Suez','Aswan','Luxor','Dakahlia','Sharqia','Beheira'] },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷', states: ['Istanbul','Ankara','Izmir','Bursa','Antalya','Adana','Konya','Gaziantep','Mersin','Kayseri'] },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', states: ['Jakarta','West Java','East Java','Central Java','North Sumatra','South Sulawesi','Bali','Riau','South Sumatra','Banten'] },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', states: ['Selangor','Johor','Kuala Lumpur','Penang','Sabah','Sarawak','Perak','Kedah','Negeri Sembilan','Melaka'] },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭', states: ['Bangkok','Chiang Mai','Nonthaburi','Samut Prakan','Udon Thani','Surat Thani','Chon Buri','Khon Kaen','Nakhon Ratchasima','Lampang'] },
];
