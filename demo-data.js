export const DEMO_SITE = {
  brand_name: "Blue Mountain Stays",
  tagline: "Handpicked villas and cottages across Jamaica, booked directly with your host.",
  contact_email: "",
  contact_phone: "",
  properties: [
    { id: "demo-1", name: "Seaside Villa", location: "Negril, Westmoreland", bedrooms: 3, rate: 240, description: "Steps from Seven Mile Beach with a private pool, shaded veranda and sunset views over the Caribbean. Breakfast and a chef can be arranged.", photos: ["/demo/villa.svg", "/demo/beach.svg", "/demo/cottage.svg"], amenities: ["WiFi", "Pool", "Air conditioning", "Private chef", "Parking", "BBQ"] },
    { id: "demo-2", name: "Hillside Cottage", location: "Port Antonio, Portland", bedrooms: 2, rate: 150, description: "A quiet cottage in the Portland hills with garden, river nearby and fresh Blue Mountain coffee every morning.", photos: ["/demo/cottage.svg", "/demo/beach.svg"], amenities: ["WiFi", "Garden", "Kitchen", "Hammock"] },
    { id: "demo-3", name: "New Kingston Loft", location: "New Kingston, St. Andrew", bedrooms: 1, rate: 95, description: "Modern city loft close to restaurants, business districts and nightlife. Fast fibre internet and a dedicated workspace.", photos: ["/demo/loft.svg"], amenities: ["WiFi", "Workspace", "Air conditioning", "Secure parking"] },
    { id: "demo-4", name: "Treasure Beach Retreat", location: "Treasure Beach, St. Elizabeth", bedrooms: 4, rate: 310, description: "Spacious family retreat by the quiet south coast with room for the whole group and a sea-view terrace.", photos: ["/demo/beach.svg", "/demo/villa.svg"], amenities: ["WiFi", "Sea view", "Kitchen", "Parking", "Terrace"] }
  ]
};

export function demoBusy() {
  const day = 86400000;
  const iso = (offset) => new Date(Date.now() + offset * day).toISOString().slice(0, 10);
  return [{ check_in: iso(6), check_out: iso(10) }, { check_in: iso(20), check_out: iso(24) }];
}
