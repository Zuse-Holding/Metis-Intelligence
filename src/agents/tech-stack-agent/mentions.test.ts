import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mentionQuery, mentionsFrom } from "./mentions.js";
import { TechStackAgent } from "./index.js";
import { techSummary } from "./render.js";

describe("public mentions: vendor customer stories", () => {
  const results = [
    { title: "Graybar Electric drives growth with Salesforce", url: "https://www.salesforce.com/customer-stories/graybar/" },
    { title: "How Graybar Electric runs its warehouses on SAP", url: "https://news.example.com/graybar-sap" },
    { title: "Graybar Electric case study", url: "https://www.hubspot.com/pricing" },
    { title: "Acme Corp and Snowflake", url: "https://www.snowflake.com/en/customers/all-customers/case-study/acme/" },
    { title: "Graybar Electric | Snowflake", url: "http://www.snowflake.com/customers/graybar-electric/" },
    { title: "Graybar Electric moves its data to Snowflake", url: "https://www.snowflake.com/en/customers/graybar-electric/" },
  ];

  it("keeps only the vendor's own customer-story pages that are about the company", () => {
    const got = mentionsFrom(results, "Graybar Electric Company, Inc.");
    assert.deepEqual(got.map((m) => [m.vendor, m.url]), [
      ["Salesforce", "https://www.salesforce.com/customer-stories/graybar/"],
      ["Snowflake", "https://www.snowflake.com/en/customers/graybar-electric/"],
    ]);
  });

  it("needs the name in both the title and the address for a one-word name", () => {
    const one = [
      { title: "Patagonia's ecommerce on Shopify Plus", url: "https://www.shopify.com/case-studies/patagonia" },
      { title: "Outdoor brands on Shopify", url: "https://www.shopify.com/case-studies/patagonia" },
      { title: "Patagonia expedition gear story", url: "https://www.shopify.com/case-studies/rei" },
    ];
    assert.deepEqual(mentionsFrom(one, "Patagonia").map((m) => m.title), ["Patagonia's ecommerce on Shopify Plus"]);
  });

  it("reads any vendor's own customer story, but not articles, schools or the company's own site", () => {
    const live = [
      { title: "How Limbach Transformed Building Performance with Facilio", url: "https://facilio.com/case-study/limbach/" },
      { title: "MSUITE Case Study - Limbach", url: "https://www.msuite.com/wp-content/uploads/2024/10/MSUITE-Limbach-Case-Study-10272024.pdf" },
      { title: "Limbach Group Case Study: Standardised Multi-Site SOPs", url: "https://getflowshare.com/case-studies/limbach-group/" },
      { title: "Case Study-Redefining System Limits", url: "https://www.limbachinc.com/portfolio/case-study-limbach/" },
      { title: "Case Study: Limbach achieves savings", url: "https://www.casestudies.com/company/igs/case-study/limbach" },
      { title: "Limbach Case Study", url: "https://business.uccs.edu/case-studies/limbach" },
    ];
    assert.deepEqual(mentionsFrom(live, "Limbach", "limbachinc.com").map((m) => [m.vendor, m.category]), [["Facilio", "Other vendors"], ["Msuite", "Other vendors"]]);
    const articles = [
      { title: "Patagonia: Impact Business Case Study", url: "https://www.causeartist.com/case-studies/patagonia" },
      { title: "Patagonia: Doughnut Design Case Study | DEAL", url: "https://doughnuteconomics.org/stories/patagonia-doughnut-design-case-study" },
      { title: "Design and Inquiry - Patagonia: A Case Study", url: "https://sites.google.com/view/designandinquiry/case-studies/patagonia-a-case-study" },
    ];
    assert.deepEqual(mentionsFrom(articles, "Patagonia", "patagonia.com"), []);
    assert.deepEqual(mentionsFrom([{ title: "Gecko Robotics Case Study: CNAPP", url: "https://www.datatheorem.com/customers/gecko-robotics/" }], "Gecko Robotics").map((m) => m.vendor), ["Datatheorem"]);
  });

  it("never lists a vendor as its own customer", () => {
    assert.deepEqual(mentionsFrom([{ title: "Salesforce customer story", url: "https://www.salesforce.com/customer-stories/salesforce/" }], "Salesforce, Inc."), []);
  });

  it("quotes the company name in the search", () => {
    assert.equal(mentionQuery(" Graybar Electric "), '"Graybar Electric" ("customer story" OR "case study")');
  });

  it("adds them to the stack as likely, cited items and says where they came from", async () => {
    const agent = new TechStackAgent();
    // No network: the DNS and homepage reads are stubbed out.
    (agent as unknown as { gather: () => Promise<unknown> }).gather = async () => ({ mx: [], txt: [], ns: [], websiteUnavailable: "blocked" });
    const { stack } = await agent.run("graybar.com", undefined, { mentions: { company: "Graybar Electric", search: async () => results } });
    const item = stack!.items.find((i) => i.vendor === "Salesforce")!;
    assert.deepEqual([item.confidence, item.layer, item.sourceUrl], ["likely", "mentions", "https://www.salesforce.com/customer-stories/graybar/"]);
    assert.match(techSummary(stack!), /likely, from subdomain names or vendor customer stories\).*and vendor customer stories\./);
  });
});
