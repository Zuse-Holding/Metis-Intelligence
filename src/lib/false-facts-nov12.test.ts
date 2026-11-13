import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { settleBoardTitles } from "./leadership.js";
import { newsAboutCompany } from "./summary.js";

// Nov 12, 2026 scorecard: two false facts in report summaries.

// homeboyindustries.org/our-story/our-leaders/, as the site reader collapses it.
const HOMEBOY = "Our Leaders Transformation Story Board of Directors Mercedes Martinez, Board Chair Community Activist Camilla Belle Activist, Actress Kelli Bernard, Vice Chair Managing Partner, Los Angeles Lighthouse Public Affairs Fr. Gregory Boyle, SJ Founder Homeboy Industries Martin Cabrera Jr. CEO and Founder Cabrera Capital Markets and Cabrera Capital Partners Lizette Carbajal VP, Community Relations and Communications NBC4 and Telemundo John Cusenza Investor Valerie De La Garza Chief Executive Officer Fenton Communications Hilda Echeveria , Secretary Partner Ernst & Young";

describe("board members' titles at other firms", () => {
  const entries = () => [
    { name: "Fr. Gregory Boyle", title: "Founder" },
    { name: "Martin Cabrera Jr.", title: "CEO and Founder" },
    { name: "Mercedes Martinez", title: "Board Chair" },
    { name: "Kelli Bernard", title: "Vice Chair" },
    { name: "Lizette Carbajal", title: "VP, Community Relations and Communications" },
    { name: "Valerie De La Garza", title: "Chief Executive Officer" },
    { name: "Hilda Echeveria", title: "Secretary" },
  ];

  it("a title followed by another firm becomes the board role (Homeboy)", () => {
    const out = settleBoardTitles(entries(), [HOMEBOY], "Homeboy Industries", "homeboyindustries.org");
    assert.deepEqual(Object.fromEntries(out.map((e) => [e.name, e.title])), {
      "Fr. Gregory Boyle": "Founder",
      "Martin Cabrera Jr.": "Board member",
      "Mercedes Martinez": "Board Chair",
      "Kelli Bernard": "Vice Chair",
      "Lizette Carbajal": "Board member",
      "Valerie De La Garza": "Board member",
      "Hilda Echeveria": "Secretary",
    });
  });

  it("a title that carries another firm, or that the page doesn't give, becomes the board office", () => {
    const out = settleBoardTitles([
      { name: "Kelli Bernard", title: "Managing Partner, Los Angeles Lighthouse Public Affairs" },
      { name: "Camilla Belle", title: "Vice Chair" },
    ], [HOMEBOY], "Homeboy Industries", "homeboyindustries.org");
    assert.deepEqual(out.map((e) => e.title), ["Vice Chair", "Board member"]);
  });

  it("leaves people named outside a board section alone", () => {
    const team = "Leadership Team Martin Cabrera Jr. CEO Acme Capital Partners";
    const out = settleBoardTitles([{ name: "Martin Cabrera Jr.", title: "CEO" }], [team], "Homeboy Industries", "homeboyindustries.org");
    assert.equal(out[0].title, "CEO");
  });

  it("a company's own executives on its board keep their titles", () => {
    const page = "Board of Directors Jake Loosararian CEO Troy Demmer Co-founder Gecko Robotics Jane Roe Independent Director";
    const out = settleBoardTitles([{ name: "Jake Loosararian", title: "CEO" }, { name: "Troy Demmer", title: "Co-founder" }], [page], "Gecko Robotics", "geckorobotics.com");
    assert.deepEqual(out.map((e) => e.title), ["CEO", "Co-founder"]);
  });

  it("the board section ends at the staff heading", () => {
    const page = "Board of Directors Mercedes Martinez Board Chair Leadership Team Tom Vozzo CEO since 2012 at the former Cabrera firm";
    const out = settleBoardTitles([{ name: "Tom Vozzo", title: "CEO" }], [page], "Homeboy Industries", "homeboyindustries.org");
    assert.equal(out[0].title, "CEO");
  });
});

describe("summary news is about the company, not a namesake", () => {
  it("drops a same-word brand (Gecko the jewellers)", () => {
    assert.equal(newsAboutCompany({ headline: "Movado Group and Gecko among latest exhibitors confirmed for Retail Jeweller Festival 2027" }, "Gecko Robotics", "https://www.geckorobotics.com"), false);
    assert.equal(newsAboutCompany({ headline: "Pitt Athletics and Gecko Robotics Announce Men's Basketball Jersey Patch Partnership" }, "Gecko Robotics", "https://www.geckorobotics.com"), true);
  });

  it("legal words aren't required, and words match by stem", () => {
    assert.equal(newsAboutCompany({ headline: "Homeboy opens a new bakery" }, "Homeboy Industries"), true);
    assert.equal(newsAboutCompany({ headline: "Graybar Makes $100,000 Donation", summary: "The electrical distributor gave..." }, "Graybar Electric Company"), true);
    assert.equal(newsAboutCompany({ headline: "Graybar Makes $100,000 Donation" }, "Graybar Electric Company"), false);
  });

  it("an item on the company's own site counts", () => {
    assert.equal(newsAboutCompany({ headline: "We're hiring", url: "https://www.geckorobotics.com/news/x" }, "Gecko Robotics", "https://geckorobotics.com"), true);
  });
});

describe("a board member's title survives a second extraction", () => {
  it("de-duplication keeps the board role and files the other titles as disputed, in either order", async () => {
    const { cleanLeadership } = await import("./leadership.js");
    const board = () => ({ name: "Martin Cabrera Jr.", title: "Board member", boardMember: true, sourceUrl: "https://homeboyindustries.org/our-story/our-leaders/" });
    const other = () => ({ name: "Martin Cabrera Jr.", title: "CEO and Founder", sourceUrl: "https://homeboyindustries.org/our-story/our-leaders/" });
    for (const list of [[board(), other()], [other(), board()]]) {
      const [e] = cleanLeadership(list, "homeboyindustries.org").filter((l) => l.name.startsWith("Martin"));
      assert.equal(e.title, "Board member");
      assert.equal(e.boardMember, true);
      assert.deepEqual(e.disputedTitles, ["CEO", "Founder"]);
    }
  });

  it("a board member is never who the summary says leads the company", async () => {
    const { composeSummary } = await import("./summary.js");
    const s = composeSummary({
      query: "x", generatedAt: "2026-11-13", company: { name: "Homeboy Industries", website: "https://homeboyindustries.org", description: "Homeboy Industries offers job training and re-entry services in Los Angeles.", founded: "1988", headquarters: "Los Angeles, CA" },
      leadership: [{ name: "Martin Cabrera Jr.", title: "CEO and Founder", boardMember: true }, { name: "Steve Delgado", title: "Chief Executive Officer" }],
      products: [], news: [], funding: [], competitors: [], sources: [],
    } as unknown as Parameters<typeof composeSummary>[0], Date.parse("2026-11-13"));
    assert.match(s ?? "", /Led by Steve Delgado \(Chief Executive Officer\)\./);
    assert.doesNotMatch(s ?? "", /Cabrera/);
  });
});
