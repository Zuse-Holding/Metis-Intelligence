/**
 * The vendor pattern table for tech stack detection (ABM brief §2), and the
 * only place vendor patterns live: domain posture's "Systems in use" reads
 * its mail-record vendors from here too. Add a vendor by adding a row; no
 * agent prompt or detector change is needed.
 *
 * Signal kinds, all public and passive:
 *   mail    an MX host, an SPF include, or a domain-verification TXT token
 *   ns      a name server
 *   cname   a CNAME target for the site's hostname (www and the bare domain)
 *   ip      the cloud whose published IP ranges hold the site's address
 *   header  an HTTP response header on the homepage (name, optional value)
 *   html    a script, stylesheet, iframe, form action, pixel or generator tag
 *           on the homepage (never its visible text)
 *
 * A row only names a vendor the record or tag names outright. Nothing is
 * inferred from industry, size or what similar companies use.
 */

export type TechCategory =
  | "Email" | "Email security" | "Email delivery" | "Marketing automation" | "CRM" | "Sales intelligence"
  | "Customer support" | "Live chat" | "Collaboration" | "E-signature" | "Accounting and ERP" | "Payments"
  | "Identity and security" | "IT service management" | "Hosting" | "CDN and security" | "DNS" | "CMS"
  | "E-commerce" | "Analytics" | "Tag management" | "Advertising" | "Consent management" | "Scheduling"
  | "Forms" | "Monitoring" | "Recruiting" | "Reviews and messaging" | "Video" | "Business identity"
  | "Business intelligence" | "Developer tools" | "Construction management" | "HR and payroll" | "Other vendors";

/** Display order for the report section. */
export const CATEGORY_ORDER: TechCategory[] = [
  "CRM", "Marketing automation", "Sales intelligence", "Email", "Email delivery", "Email security",
  "Customer support", "Live chat", "Reviews and messaging", "Collaboration", "E-signature", "Accounting and ERP",
  "Construction management", "HR and payroll",
  "Payments", "E-commerce", "Identity and security", "IT service management", "Business intelligence", "Recruiting",
  "Scheduling", "Forms", "CMS", "Hosting", "CDN and security", "DNS", "Developer tools", "Analytics", "Tag management",
  "Advertising", "Consent management", "Monitoring", "Video", "Business identity", "Other vendors",
];

export type IpProvider = "aws" | "cloudfront" | "gcp" | "cloudflare";

export type Signal =
  | { kind: "mail"; re: RegExp }
  | { kind: "ns"; re: RegExp }
  | { kind: "cname"; re: RegExp }
  | { kind: "ip"; provider: IpProvider }
  | { kind: "header"; name: string; re?: RegExp }
  | { kind: "html"; re: RegExp }
  /** A word in one of the company's own subdomain names from certificate
   *  logs ("jira" in jira.corp.acme.com). The name alone is suggestive,
   *  not proof, so these items are "likely". */
  | { kind: "subdomain"; re: RegExp };

export interface VendorDef {
  vendor: string;
  category: TechCategory;
  signals: Signal[];
}

const mail = (re: RegExp): Signal => ({ kind: "mail", re });
const ns = (re: RegExp): Signal => ({ kind: "ns", re });
const cname = (re: RegExp): Signal => ({ kind: "cname", re });
const header = (name: string, re?: RegExp): Signal => ({ kind: "header", name: name.toLowerCase(), re });
const html = (re: RegExp): Signal => ({ kind: "html", re });
/** Subdomain words, allowing an environment suffix: "fiori", "fioridev", "jira2". */
const sub = (...words: string[]): Signal => ({
  kind: "subdomain",
  re: new RegExp(`^(${words.join("|")})(dev|qa|test|stg|stage|staging|prod|prd|uat|\\d+)?$`, "i"),
});

export const VENDORS: VendorDef[] = [
  // ── Mail-record vendors. Kept first and in this order: domain posture's
  // "Systems in use" lists them in table order.
  { vendor: "Google Workspace", category: "Email", signals: [mail(/(^|[\s.])(aspmx\.l\.google\.com|google\.com|googlemail\.com)$|_spf\.google\.com/i)] },
  { vendor: "Microsoft 365", category: "Email", signals: [mail(/protection\.outlook\.com|spf\.protection\.outlook|^ms=ms\d+/i)] },
  { vendor: "Proofpoint", category: "Email security", signals: [mail(/pphosted\.com|ppe-hosted\.com/i)] },
  { vendor: "Mimecast", category: "Email security", signals: [mail(/mimecast/i)] },
  { vendor: "Barracuda", category: "Email security", signals: [mail(/barracudanetworks/i)] },
  { vendor: "Oracle Cloud", category: "Hosting", signals: [mail(/oracleemaildelivery|oraclecloud|oracle-cloud/i)] },
  { vendor: "HubSpot", category: "Marketing automation", signals: [
    mail(/hubspotemail|hubspot/i),
    html(/js\.hs-scripts\.com|js\.hsforms\.net|js\.hs-analytics\.net|js\.hs-banner\.com|js\.hubspot\.com|js\.usemessages\.com|hsappstatic\.net/i),
    html(/^generator:\s*HubSpot/i),
    cname(/hubspot\.net$|hs-sites\.com$|hubspotpagebuilder\.com$|hscoretech\.net$/i),
    sub("hubspot"),
  ] },
  { vendor: "Salesforce", category: "CRM", signals: [
    mail(/_spf\.salesforce\.com|salesforce/i), html(/webto\.salesforce\.com|\.my\.salesforce\.com|force\.com\/servlet/i),
    cname(/\.force\.com$|salesforce-sites\.com$|siteforce\.com$|\.my\.salesforce\.com$/i), sub("salesforce", "sfdc"),
  ] },
  { vendor: "Paubox (HIPAA email)", category: "Email security", signals: [mail(/paubox/i)] },
  { vendor: "SendGrid", category: "Email delivery", signals: [mail(/sendgrid/i), cname(/sendgrid\.net$/i)] },
  { vendor: "Mailgun", category: "Email delivery", signals: [mail(/mailgun/i), cname(/mailgun\.org$/i)] },
  { vendor: "Amazon SES", category: "Email delivery", signals: [mail(/amazonses/i)] },
  { vendor: "Mailchimp", category: "Marketing automation", signals: [mail(/mcsv\.net|mailchimp|mandrillapp|mandrill_verify/i), html(/chimpstatic\.com|list-manage\.com/i), cname(/mandrillapp\.com$|list-manage\.com$/i)] },
  { vendor: "Zendesk", category: "Customer support", signals: [mail(/zendesk/i), html(/static\.zdassets\.com|\.zendesk\.com\/embeddable|zopim/i), cname(/\.zendesk\.com$/i), sub("zendesk")] },
  { vendor: "Freshworks", category: "Customer support", signals: [mail(/freshdesk|freshworks/i), html(/wchat\.freshchat\.com|widget\.freshworks\.com/i), cname(/freshdesk\.com$|freshservice\.com$/i), sub("freshdesk", "freshservice")] },
  { vendor: "Zoho", category: "CRM", signals: [mail(/zoho/i), html(/salesiq\.zoho|zohopublic|zohocdn/i)] },
  { vendor: "Atlassian", category: "Collaboration", signals: [mail(/atlassian/i), cname(/atlassian\.net$/i), sub("jira", "confluence", "bitbucket", "atlassian")] },
  { vendor: "DocuSign", category: "E-signature", signals: [mail(/docusign/i)] },
  { vendor: "BidTracer", category: "Collaboration", signals: [mail(/bidtracer/i)] },
  { vendor: "QuickBooks", category: "Accounting and ERP", signals: [mail(/intuit|quickbooks/i)] },
  { vendor: "Stripe", category: "Payments", signals: [mail(/stripe-verification|stripe/i), html(/js\.stripe\.com/i)] },
  { vendor: "Apple Business", category: "Business identity", signals: [mail(/apple-domain-verification/i)] },
  { vendor: "Meta Business", category: "Business identity", signals: [mail(/facebook-domain-verification/i)] },

  // ── More mail-record vendors (SPF includes, MX hosts, verification tokens).
  { vendor: "Google Search Console", category: "Analytics", signals: [mail(/^google-site-verification=/i)] },
  { vendor: "Cisco Secure Email", category: "Email security", signals: [mail(/iphmx\.com/i)] },
  { vendor: "Broadcom Email Security", category: "Email security", signals: [mail(/messagelabs/i)] },
  { vendor: "AppRiver", category: "Email security", signals: [mail(/appriver/i)] },
  { vendor: "Sophos Email", category: "Email security", signals: [mail(/sophos/i)] },
  { vendor: "Rackspace Email", category: "Email", signals: [mail(/emailsrvr\.com/i)] },
  { vendor: "GoDaddy email servers", category: "Email delivery", signals: [mail(/secureserver\.net/i)] },
  { vendor: "Marketo", category: "Marketing automation", signals: [mail(/mktomail\.com/i), html(/munchkin\.marketo\.net|marketo\.com\/js\/forms2|mktoweb\.com/i), cname(/mktoweb\.com$|mktossl\.com$|mktoedge\.com$/i), sub("marketo", "mkto")] },
  { vendor: "Salesforce Marketing Cloud (Pardot)", category: "Marketing automation", signals: [html(/pi\.pardot\.com|go\.pardot\.com|cdn\.pardot\.com/i), cname(/pardot\.com$/i), sub("pardot")] },
  { vendor: "Salesforce Marketing Cloud Engagement", category: "Marketing automation", signals: [cname(/exacttarget\.com$|marketingcloudapps\.com$|sfmc-content\.com$/i)] },
  { vendor: "Mailjet", category: "Email delivery", signals: [mail(/mailjet/i)] },
  { vendor: "Brevo", category: "Marketing automation", signals: [mail(/sendinblue|brevo/i), html(/sibautomation\.com|brevo\.com\/js/i)] },
  { vendor: "Constant Contact", category: "Marketing automation", signals: [mail(/constantcontact/i), html(/ctctcdn\.com/i)] },
  { vendor: "SparkPost", category: "Email delivery", signals: [mail(/sparkpostmail/i)] },
  { vendor: "NetSuite", category: "Accounting and ERP", signals: [mail(/netsuite/i), sub("netsuite")] },
  { vendor: "ServiceNow", category: "IT service management", signals: [mail(/service-now\.com/i), cname(/service-now\.com$/i), sub("servicenow")] },
  { vendor: "Atlassian Statuspage", category: "IT service management", signals: [mail(/status-page-domain-verification/i), cname(/stspg-customer\.com$|statuspage\.io$/i)] },
  { vendor: "Slack", category: "Collaboration", signals: [mail(/slack-domain-verification/i)] },
  { vendor: "Zoom", category: "Collaboration", signals: [mail(/zoom_verify|zoom-domain-verification/i)] },
  { vendor: "Webex", category: "Collaboration", signals: [mail(/webexdomainverification|cisco-ci-domain-verification/i)] },
  { vendor: "Dropbox", category: "Collaboration", signals: [mail(/dropbox-domain-verification/i)] },
  { vendor: "Box", category: "Collaboration", signals: [mail(/^box-domain-verification=/i)] },
  { vendor: "Smartsheet", category: "Collaboration", signals: [mail(/smartsheet/i)] },
  { vendor: "Miro", category: "Collaboration", signals: [mail(/miro-verification/i)] },
  { vendor: "Adobe", category: "E-signature", signals: [mail(/adobe-idp-site-verification|adobe-sign-verification/i)] },
  { vendor: "Citrix", category: "Identity and security", signals: [mail(/citrix-verification-code/i), cname(/(^|\.)sharefile\.com$|\.cloud\.com$/i), sub("citrix", "ctx", "storefront", "netscaler")] },
  { vendor: "GoTo (LogMeIn)", category: "IT service management", signals: [mail(/logmein-verification-code/i)] },
  { vendor: "TeamViewer", category: "IT service management", signals: [mail(/teamviewer-sso-verification/i)] },
  { vendor: "Duo Security", category: "Identity and security", signals: [mail(/duo_sso_verification/i), sub("duo")] },
  { vendor: "LastPass", category: "Identity and security", signals: [mail(/lastpass-verification-code/i)] },
  { vendor: "KnowBe4", category: "Identity and security", signals: [mail(/knowbe4/i)] },
  { vendor: "Jamf", category: "IT service management", signals: [mail(/jamf-site-verification/i)] },
  { vendor: "MongoDB Atlas", category: "Hosting", signals: [mail(/mongodb-site-verification/i)] },
  { vendor: "Twilio", category: "Email delivery", signals: [mail(/twilio-domain-verification/i)] },
  { vendor: "OneTrust", category: "Consent management", signals: [mail(/onetrust-domain-verification/i), html(/cdn\.cookielaw\.org|optanon|onetrust\.com/i)] },

  // ── DNS hosting (name servers).
  { vendor: "Cloudflare", category: "CDN and security", signals: [
    ns(/\.ns\.cloudflare\.com$/i), cname(/cdn\.cloudflare\.net$/i), { kind: "ip", provider: "cloudflare" },
    header("cf-ray"), header("server", /^cloudflare$/i), html(/\/cdn-cgi\/(scripts|challenge-platform|l\/email-protection)/i),
  ] },
  { vendor: "Amazon Route 53", category: "DNS", signals: [ns(/awsdns/i)] },
  { vendor: "Azure DNS", category: "DNS", signals: [ns(/azure-dns\./i)] },
  { vendor: "Google Cloud DNS", category: "DNS", signals: [ns(/googledomains\.com$/i)] },
  { vendor: "GoDaddy DNS", category: "DNS", signals: [ns(/domaincontrol\.com$/i)] },
  { vendor: "Namecheap DNS", category: "DNS", signals: [ns(/registrar-servers\.com$/i)] },
  { vendor: "NS1", category: "DNS", signals: [ns(/nsone\.net$/i)] },
  { vendor: "UltraDNS", category: "DNS", signals: [ns(/ultradns\./i)] },
  { vendor: "DNS Made Easy", category: "DNS", signals: [ns(/dnsmadeeasy\.com$/i)] },
  { vendor: "Oracle Dyn", category: "DNS", signals: [ns(/dynect\.net$/i)] },

  // ── Hosting and CDN (CNAMEs, published IP ranges, response headers).
  { vendor: "Amazon CloudFront", category: "CDN and security", signals: [cname(/cloudfront\.net$/i), { kind: "ip", provider: "cloudfront" }, header("x-amz-cf-id")] },
  { vendor: "Amazon Web Services", category: "Hosting", signals: [cname(/(elb|s3-website[.-][a-z0-9-]+|s3|elasticbeanstalk)\.amazonaws\.com$|awsglobalaccelerator\.com$|amplifyapp\.com$/i), { kind: "ip", provider: "aws" }] },
  { vendor: "Microsoft Azure", category: "Hosting", signals: [cname(/azurewebsites\.net$|cloudapp\.(net|azure\.com)$|trafficmanager\.net$|azurestaticapps\.net$|azurecontainerapps\.io$/i)] },
  { vendor: "Azure Front Door and CDN", category: "CDN and security", signals: [cname(/azurefd\.net$|azureedge\.net$/i), header("x-azure-ref")] },
  { vendor: "Google Cloud", category: "Hosting", signals: [cname(/ghs\.googlehosted\.com$|appspot\.com$|run\.app$/i), { kind: "ip", provider: "gcp" }, header("server", /^Google Frontend$/i)] },
  { vendor: "Firebase Hosting", category: "Hosting", signals: [cname(/firebaseapp\.com$|\.web\.app$/i)] },
  { vendor: "Akamai", category: "CDN and security", signals: [cname(/edgekey\.net$|akamaiedge\.net$|edgesuite\.net$|akamaized\.net$/i), header("server", /^AkamaiGHost/i)] },
  { vendor: "Fastly", category: "CDN and security", signals: [cname(/fastly\.net$|fastlylb\.net$/i), header("x-fastly-request-id")] },
  { vendor: "Imperva", category: "CDN and security", signals: [cname(/incapdns\.net$/i), header("x-cdn", /incapsula/i), header("x-iinfo")] },
  { vendor: "Sucuri", category: "CDN and security", signals: [cname(/sucuri\.net$/i), header("x-sucuri-id")] },
  { vendor: "Vercel", category: "Hosting", signals: [cname(/vercel-dns\.com$|vercel\.app$/i), header("x-vercel-id"), header("server", /^Vercel$/i)] },
  { vendor: "Netlify", category: "Hosting", signals: [cname(/netlify\.(app|com)$|netlifyglobalcdn\.com$/i), header("x-nf-request-id"), header("server", /^Netlify$/i)] },
  { vendor: "Heroku", category: "Hosting", signals: [cname(/herokudns\.com$|herokuapp\.com$/i)] },
  { vendor: "GitHub Pages", category: "Hosting", signals: [cname(/github\.io$/i), header("x-github-request-id")] },
  { vendor: "WP Engine", category: "Hosting", signals: [cname(/wpengine\.com$|wpenginepowered\.com$/i), header("x-powered-by", /WP Engine/i), header("wpe-backend")] },
  { vendor: "Kinsta", category: "Hosting", signals: [cname(/kinsta\.(cloud|com)$/i), header("x-kinsta-cache")] },
  { vendor: "Pantheon", category: "Hosting", signals: [cname(/pantheonsite\.io$/i), header("x-pantheon-styx-hostname")] },
  { vendor: "Microsoft IIS", category: "Hosting", signals: [header("server", /^Microsoft-IIS/i)] },

  // ── Website builders and CMS.
  { vendor: "WordPress", category: "CMS", signals: [html(/^generator:\s*WordPress/i), html(/\/wp-content\/|\/wp-includes\//i)] },
  { vendor: "Drupal", category: "CMS", signals: [html(/^generator:\s*Drupal/i), header("x-generator", /Drupal/i)] },
  { vendor: "Joomla", category: "CMS", signals: [html(/^generator:\s*Joomla/i)] },
  { vendor: "Webflow", category: "CMS", signals: [cname(/proxy-ssl\.webflow\.com$|webflow\.io$/i), html(/^generator:\s*Webflow/i), html(/assets\.website-files\.com|uploads-ssl\.webflow\.com/i)] },
  { vendor: "Squarespace", category: "CMS", signals: [cname(/squarespace\.com$/i), header("server", /^Squarespace/i), html(/static1\.squarespace\.com|assets\.squarespace\.com/i)] },
  { vendor: "Wix", category: "CMS", signals: [cname(/wixdns\.net$/i), ns(/wixdns\.net$/i), header("x-wix-request-id"), html(/^generator:\s*Wix/i), html(/static\.wixstatic\.com|static\.parastorage\.com/i)] },
  { vendor: "GoDaddy Website Builder", category: "CMS", signals: [cname(/godaddysites\.com$/i), html(/img1\.wsimg\.com\/(blobby|isteam)/i)] },
  { vendor: "Duda", category: "CMS", signals: [html(/dd-cdn\.multiscreensite\.com|irp\.cdn-website\.com/i)] },
  { vendor: "Shopify", category: "E-commerce", signals: [cname(/myshopify\.com$/i), header("x-shopify-stage"), header("x-shopid"), html(/cdn\.shopify\.com/i), sub("shopify")] },
  { vendor: "BigCommerce", category: "E-commerce", signals: [html(/cdn\d*\.bigcommerce\.com/i)] },
  { vendor: "WooCommerce", category: "E-commerce", signals: [html(/\/plugins\/woocommerce\//i)] },

  // ── Analytics, tags and ads.
  { vendor: "Google Tag Manager", category: "Tag management", signals: [html(/googletagmanager\.com\/gtm\.js|googletagmanager\.com\/ns\.html/i)] },
  { vendor: "Google Analytics", category: "Analytics", signals: [html(/googletagmanager\.com\/gtag\/js\?id=G-|google-analytics\.com\/(analytics|ga)\.js|gtag\(\s*['"]config['"]\s*,\s*['"]G-/i)] },
  { vendor: "Google Ads", category: "Advertising", signals: [html(/googleadservices\.com|googletagmanager\.com\/gtag\/js\?id=AW-|gtag\(\s*['"]config['"]\s*,\s*['"]AW-/i)] },
  { vendor: "Meta Pixel", category: "Advertising", signals: [html(/connect\.facebook\.net\/[^"' ]*\/fbevents\.js|facebook\.com\/tr\?id=/i)] },
  { vendor: "LinkedIn Insight Tag", category: "Advertising", signals: [html(/snap\.licdn\.com\/li\.lms-analytics|px\.ads\.linkedin\.com/i)] },
  { vendor: "Microsoft Advertising", category: "Advertising", signals: [html(/bat\.bing\.com/i)] },
  { vendor: "TikTok Pixel", category: "Advertising", signals: [html(/analytics\.tiktok\.com/i)] },
  { vendor: "X (Twitter) Pixel", category: "Advertising", signals: [html(/static\.ads-twitter\.com/i)] },
  { vendor: "Hotjar", category: "Analytics", signals: [html(/static\.hotjar\.com/i)] },
  { vendor: "Microsoft Clarity", category: "Analytics", signals: [html(/www\.clarity\.ms/i)] },
  { vendor: "Segment", category: "Analytics", signals: [html(/cdn\.segment\.com/i)] },
  { vendor: "Mixpanel", category: "Analytics", signals: [html(/cdn\.mxpnl\.com|cdn4\.mxpnl\.com/i)] },
  { vendor: "Amplitude", category: "Analytics", signals: [html(/cdn\.amplitude\.com/i)] },
  { vendor: "Heap", category: "Analytics", signals: [html(/cdn\.heapanalytics\.com/i)] },
  { vendor: "FullStory", category: "Analytics", signals: [html(/edge\.fullstory\.com|fullstory\.com\/s\/fs\.js/i)] },
  { vendor: "Optimizely", category: "Analytics", signals: [html(/cdn\.optimizely\.com/i)] },
  { vendor: "VWO", category: "Analytics", signals: [html(/dev\.visualwebsiteoptimizer\.com/i)] },
  { vendor: "Adobe Experience Cloud", category: "Analytics", signals: [html(/assets\.adobedtm\.com/i)] },
  { vendor: "Tealium", category: "Tag management", signals: [html(/tags\.tiqcdn\.com/i)] },

  // ── Sales intelligence and website visitor identification.
  { vendor: "ZoomInfo", category: "Sales intelligence", signals: [html(/ws\.zoominfo\.com|js\.zi-scripts\.com/i)] },
  { vendor: "6sense", category: "Sales intelligence", signals: [html(/j\.6sc\.co/i)] },
  { vendor: "Demandbase", category: "Sales intelligence", signals: [html(/tag\.demandbase\.com/i)] },
  { vendor: "Clearbit", category: "Sales intelligence", signals: [html(/tag\.clearbitscripts\.com/i)] },
  { vendor: "Qualified", category: "Live chat", signals: [html(/js\.qualified\.com/i)] },

  // ── Chat, support and customer messaging.
  { vendor: "Intercom", category: "Live chat", signals: [html(/widget\.intercom\.io|js\.intercomcdn\.com/i), cname(/custom\.intercom\.help$|intercom\.help$/i)] },
  { vendor: "Drift", category: "Live chat", signals: [html(/js\.driftt\.com/i)] },
  { vendor: "LiveChat", category: "Live chat", signals: [html(/cdn\.livechatinc\.com/i)] },
  { vendor: "Tawk.to", category: "Live chat", signals: [html(/embed\.tawk\.to/i)] },
  { vendor: "Crisp", category: "Live chat", signals: [html(/client\.crisp\.chat/i)] },
  { vendor: "Olark", category: "Live chat", signals: [html(/static\.olark\.com/i)] },
  { vendor: "Podium", category: "Reviews and messaging", signals: [html(/connect\.podium\.com/i)] },
  { vendor: "Birdeye", category: "Reviews and messaging", signals: [html(/birdeye\.com\/embed|birdeye\.com\/widget/i)] },
  { vendor: "Klaviyo", category: "Marketing automation", signals: [html(/static\.klaviyo\.com/i), cname(/klaviyomail\.com$|klclick\d*\.com$/i)] },
  { vendor: "ActiveCampaign", category: "Marketing automation", signals: [html(/trackcmp\.net|\.activehosted\.com/i)] },

  // ── Payments, scheduling, forms.
  { vendor: "PayPal", category: "Payments", signals: [html(/paypal\.com\/sdk\/js|paypalobjects\.com/i)] },
  { vendor: "Square", category: "Payments", signals: [html(/web\.squarecdn\.com|js\.squareup\.com/i)] },
  { vendor: "Calendly", category: "Scheduling", signals: [html(/assets\.calendly\.com|calendly\.com\/assets\/external\/widget/i)] },
  { vendor: "Typeform", category: "Forms", signals: [html(/embed\.typeform\.com/i)] },
  { vendor: "Jotform", category: "Forms", signals: [html(/form\.jotform\.com|cdn\.jotfor\.ms/i)] },
  { vendor: "Gravity Forms", category: "Forms", signals: [html(/\/plugins\/gravityforms\//i)] },

  // ── Consent, monitoring, video.
  { vendor: "Cookiebot", category: "Consent management", signals: [html(/consent\.cookiebot\.com/i)] },
  { vendor: "TrustArc", category: "Consent management", signals: [html(/consent\.trustarc\.com/i)] },
  { vendor: "Osano", category: "Consent management", signals: [html(/cmp\.osano\.com/i)] },
  { vendor: "Sentry", category: "Monitoring", signals: [html(/browser\.sentry-cdn\.com|js\.sentry-cdn\.com/i)] },
  { vendor: "Datadog", category: "Monitoring", signals: [html(/datadoghq-browser-agent\.com|www\.datadoghq-browser-agent/i)] },
  { vendor: "New Relic", category: "Monitoring", signals: [html(/js-agent\.newrelic\.com|bam\.nr-data\.net/i)] },
  { vendor: "Wistia", category: "Video", signals: [html(/fast\.wistia\.(com|net)/i)] },
  { vendor: "Vimeo", category: "Video", signals: [html(/player\.vimeo\.com/i)] },

  // ── Recruiting (careers pages embedded or linked from the homepage).
  { vendor: "Greenhouse", category: "Recruiting", signals: [html(/boards\.greenhouse\.io|job-boards\.greenhouse\.io/i)] },
  { vendor: "Lever", category: "Recruiting", signals: [html(/jobs\.lever\.co/i)] },
  { vendor: "Workday", category: "Recruiting", signals: [html(/myworkdayjobs\.com/i), cname(/myworkdayjobs\.com$|workday\.com$/i), sub("workday")] },
  { vendor: "iCIMS", category: "Recruiting", signals: [html(/\.icims\.com/i)] },
  { vendor: "BambooHR", category: "Recruiting", signals: [html(/\.bamboohr\.com\/(careers|jobs)/i)] },
  { vendor: "ADP", category: "Recruiting", signals: [html(/workforcenow\.adp\.com/i)] },
  { vendor: "Paylocity", category: "Recruiting", signals: [html(/recruiting\.paylocity\.com/i)] },

  // ── Mostly seen through the company's own subdomains (tech stack phase 2):
  // a CNAME to the vendor is confirmed; a subdomain name alone is likely.
  { vendor: "Okta", category: "Identity and security", signals: [cname(/okta(preview|-emea)?\.com$|oktacdn\.com$/i), sub("okta")] },
  { vendor: "Auth0", category: "Identity and security", signals: [cname(/auth0\.com$/i), sub("auth0")] },
  { vendor: "Ping Identity", category: "Identity and security", signals: [cname(/pingone\.com$|pingidentity\.com$/i), sub("pingfed", "pingfederate", "pingone")] },
  { vendor: "Microsoft AD FS", category: "Identity and security", signals: [sub("adfs")] },
  { vendor: "Zscaler", category: "Identity and security", signals: [cname(/zscaler(two|three|beta)?\.net$/i), sub("zscaler")] },
  { vendor: "Palo Alto Networks GlobalProtect", category: "Identity and security", signals: [sub("globalprotect")] },
  { vendor: "Cisco AnyConnect", category: "Identity and security", signals: [sub("anyconnect")] },
  { vendor: "Fortinet", category: "Identity and security", signals: [sub("fortigate", "fortinet", "fortivpn", "forticlient")] },
  { vendor: "Ivanti Pulse Secure", category: "Identity and security", signals: [sub("pulsesecure")] },
  { vendor: "Microsoft Exchange (on-premises)", category: "Email", signals: [sub("owa", "exchange", "exchmail")] },
  { vendor: "Microsoft SharePoint", category: "Collaboration", signals: [sub("sharepoint")] },
  { vendor: "Microsoft Dynamics 365", category: "CRM", signals: [cname(/\.dynamics\.com$/i), sub("d365", "dynamics", "dynamics365")] },
  { vendor: "SAP", category: "Accounting and ERP", signals: [cname(/\.ondemand\.com$|sapbydesign\.com$|s4hana\.cloud\.sap$/i), sub("sap", "fiori", "s4hana", "hana", "saprouter", "sapgw")] },
  { vendor: "Oracle Applications", category: "Accounting and ERP", signals: [cname(/oraclecloud\.com$/i), sub("peoplesoft", "jde", "jdedwards", "oracleebs")] },
  { vendor: "Tableau", category: "Business intelligence", signals: [cname(/tableau\.com$/i), sub("tableau")] },
  { vendor: "Microsoft Power BI", category: "Business intelligence", signals: [sub("powerbi")] },
  { vendor: "Looker", category: "Business intelligence", signals: [cname(/looker\.com$/i), sub("looker")] },
  { vendor: "Grafana", category: "Monitoring", signals: [cname(/grafana\.net$/i), sub("grafana")] },
  { vendor: "Elastic", category: "Monitoring", signals: [cname(/elastic-cloud\.com$|found\.io$/i), sub("kibana", "elastic", "elasticsearch")] },
  { vendor: "GitLab", category: "Developer tools", signals: [cname(/gitlab\.io$/i), sub("gitlab")] },
  { vendor: "GitHub Enterprise", category: "Developer tools", signals: [sub("github", "ghe")] },
  { vendor: "Jenkins", category: "Developer tools", signals: [sub("jenkins")] },
  { vendor: "GitBook", category: "Developer tools", signals: [cname(/gitbook\.io$/i)] },
  { vendor: "ReadMe", category: "Developer tools", signals: [cname(/readme\.io$|readmessl\.com$/i)] },
  { vendor: "VMware", category: "Hosting", signals: [sub("vcenter", "vsphere", "vmware")] },
  { vendor: "Help Scout", category: "Customer support", signals: [cname(/helpscoutdocs\.com$/i)] },
  { vendor: "Unbounce", category: "Marketing automation", signals: [cname(/unbouncepages\.com$/i)] },
  { vendor: "Instapage", category: "Marketing automation", signals: [cname(/pageserve\.co$/i)] },
  { vendor: "Braze", category: "Marketing automation", signals: [cname(/braze\.com$|appboy\.com$/i)] },
  { vendor: "Iterable", category: "Marketing automation", signals: [cname(/iterable\.com$/i)] },
  { vendor: "Cvent", category: "Marketing automation", signals: [cname(/cvent\.com$/i), sub("cvent")] },
  { vendor: "Qualtrics", category: "Analytics", signals: [cname(/qualtrics\.com$/i), sub("qualtrics")] },
];

// ── Mail-record matching (shared with domain posture's "Systems in use") ─────

const MAIL_RECORD_SKIP = /^v=(DKIM1|DMARC1)\b/i;

/** The records a mail signal is tested against: MX hosts, then every apex
 *  TXT record (SPF and verification tokens) except DKIM/DMARC. */
export function mailRecords(mx: string[] | undefined, txt: string[] | undefined): { record: string; isMx: boolean }[] {
  return [
    ...(mx ?? []).map((r) => ({ record: r, isMx: true })),
    ...(txt ?? []).filter((t) => !MAIL_RECORD_SKIP.test(t)).map((t) => ({ record: t, isMx: false })),
  ];
}

/** An MX record is "10 host"; its host is tested on its own too, so an
 *  end-anchored pattern still matches it. */
export function mailMatches(re: RegExp, record: string): boolean {
  return re.test(record) || re.test(record.trim().split(/\s+/).pop() ?? "");
}

/** Vendors named by mail records, in table order (domain posture). */
export function mailVendors(mx: string[] | undefined, txt: string[] | undefined): string[] {
  const records = mailRecords(mx, txt);
  return VENDORS
    .filter((v) => v.signals.some((sig) => sig.kind === "mail" && records.some((r) => mailMatches(sig.re, r.record))))
    .map((v) => v.vendor);
}
