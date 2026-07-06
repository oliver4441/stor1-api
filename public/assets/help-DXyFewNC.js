import{j as e,C as n}from"./admin-CGhwvvhm.js";import{L as s}from"./vendor-DAvk9mcP.js";const d=[{title:"Getting Started",links:[{to:"/help/shopping-guide",label:"Shopping Guide",desc:"Learn how to browse, search, and shop on Omix Store"},{to:"/help/payment",label:"How Do I Pay on Omix Store",desc:"Accepted payment methods and how to complete checkout"},{to:"/help/delivery-time",label:"How Long Does My Order Arrive",desc:"Estimated delivery times and tracking your order"}]},{title:"Orders & Policies",links:[{to:"/help/delivery",label:"Delivery and Shipping",desc:"Shipping rates, coverage areas, and delivery process"},{to:"/help/refund",label:"How to Apply for a Refund",desc:"Refund eligibility, process, and timelines"},{to:"/help/after-sale",label:"After Sale Policy",desc:"Post-purchase support and warranty information"},{to:"/help/dispute-resolution",label:"Dispute Resolution Policy",desc:"How we handle disputes between buyers and sellers"}]},{title:"More",links:[{to:"/help/faq",label:"FAQ Center",desc:"Answers to the most common questions"},{to:"/help/flash-sale",label:"Flash Sale",desc:"Limited-time deals and how they work"}]}];function a(){return e.jsx("div",{className:"min-h-screen bg-zinc-950",children:e.jsxs("div",{className:"max-w-4xl mx-auto px-4 py-16",children:[e.jsxs("div",{className:"text-center mb-12",children:[e.jsx("h1",{className:"text-3xl md:text-4xl font-black text-white mb-3",children:"Customer Help Center"}),e.jsx("p",{className:"text-zinc-400 max-w-lg mx-auto",children:"Everything you need to know about shopping on Omix Store"})]}),e.jsx("div",{className:"backdrop-blur-xl bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 mb-8",children:e.jsx("p",{className:"text-sm text-zinc-400 text-center",children:"Browse topics below or use the search bar at the top of the page to find answers fast"})}),d.map(l=>e.jsxs("div",{className:"mb-10",children:[e.jsx("h2",{className:"text-lg font-bold text-zinc-200 mb-4 px-1",children:l.title}),e.jsx("div",{className:"grid grid-cols-1 md:grid-cols-2 gap-3",children:l.links.map(t=>e.jsxs(s,{to:t.to,className:"group bg-zinc-900/70 border border-zinc-800 rounded-xl p-5 hover:border-primary/30 hover:shadow-md transition-all",children:[e.jsx("h3",{className:"font-bold text-white text-sm mb-1 group-hover:text-primary transition-colors",children:t.label}),e.jsx("p",{className:"text-xs text-zinc-400 leading-relaxed",children:t.desc})]},t.to))})]},l.title)),e.jsxs("div",{className:"backdrop-blur-xl bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 text-center mt-8",children:[e.jsx("h3",{className:"font-bold text-white mb-2",children:"Still need help?"}),e.jsx("p",{className:"text-sm text-zinc-400 mb-4",children:"Contact us via WhatsApp or email and we will get back to you within 24 hours"}),e.jsxs("div",{className:"flex flex-wrap justify-center gap-3",children:[e.jsx("a",{href:"https://wa.me/254768213649",target:"_blank",rel:"noopener noreferrer",className:"inline-flex items-center gap-2 px-4 py-2 bg-green-500 text-white text-sm font-bold rounded-lg hover:bg-green-600 transition-colors",children:"WhatsApp"}),e.jsx("a",{href:"mailto:omixsystems@gmail.com",className:"inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-sm font-bold rounded-lg hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors",children:"Email Us"})]})]})]})})}const A=Object.freeze(Object.defineProperty({__proto__:null,default:a},Symbol.toStringTag,{value:"Module"}));function i({title:l,children:t,backLabel:r="Back to Help Center"}){return e.jsx("div",{className:"min-h-screen bg-zinc-950",children:e.jsxs("div",{className:"max-w-3xl mx-auto px-4 py-10",children:[e.jsxs("div",{className:"flex items-center gap-2 text-sm text-zinc-400 mb-8",children:[e.jsx(s,{to:"/help",className:"hover:text-primary transition-colors",children:"Help Center"}),e.jsx(n,{className:"w-3 h-3"}),e.jsx("span",{className:"text-zinc-300 font-medium",children:l})]}),e.jsxs("div",{className:"bg-zinc-900/70 border border-zinc-800 rounded-2xl p-6 md:p-8",children:[e.jsx("h1",{className:"text-2xl md:text-3xl font-black text-white mb-6",children:l}),e.jsx("div",{className:"prose prose-invert max-w-none text-sm leading-relaxed text-zinc-400 space-y-4",children:t})]}),e.jsx("div",{className:"mt-6 text-center",children:e.jsxs(s,{to:"/help",className:"inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-primary transition-colors font-medium",children:[e.jsx(n,{className:"w-3 h-3 rotate-180"}),r]})})]})})}function o({steps:l}){return e.jsx("div",{className:"space-y-8 my-6",children:l.map((t,r)=>e.jsxs("div",{className:"flex gap-4",children:[e.jsx("div",{className:"flex-shrink-0",children:e.jsx("div",{className:"w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--seasonal-primary,#1a5632)] to-[var(--seasonal-secondary,#14472a)] flex items-center justify-center text-white font-bold text-lg",children:r+1})}),e.jsxs("div",{className:"flex-1",children:[e.jsx("h3",{className:"font-bold text-white text-lg mb-2",children:t.title}),e.jsx("p",{className:"text-zinc-400 text-sm leading-relaxed mb-4",children:t.desc}),t.svg&&e.jsx("div",{className:"bg-zinc-800/50 rounded-xl p-6 border border-zinc-700 overflow-hidden",children:e.jsx("div",{className:"max-w-lg mx-auto",dangerouslySetInnerHTML:{__html:t.svg}})})]})]},r))})}const x=[{title:"Browse or Search Products",desc:"Use the search bar at the top of any page to find products by name, category, or keyword. Or browse categories from the navigation menu.",svg:`<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="50" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>
      <path d="M120 25l6 6 6-6" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>
      <text x="140" y="28" font-size="12" fill="#64748b">Search for anything...</text>
      <rect x="0" y="60" width="120" height="35" rx="6" fill="#1a5632"/>
      <text x="60" y="82" font-size="11" fill="white" text-anchor="middle" font-weight="bold">Electronics</text>
      <rect x="130" y="60" width="120" height="35" rx="6" fill="#10b981"/>
      <text x="190" y="82" font-size="11" fill="white" text-anchor="middle" font-weight="bold">Shoes</text>
      <rect x="260" y="60" width="120" height="35" rx="6" fill="#3b82f6"/>
      <text x="320" y="82" font-size="11" fill="white" text-anchor="middle" font-weight="bold">Clothing</text>
    </svg>`},{title:"View Product Details",desc:"Click any product card to see full details including images, price, description, variants (size/color), and the Add to Cart button.",svg:`<svg viewBox="0 0 400 120" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="120" rx="8" fill="#1e293b"/>
      <rect x="20" y="20" width="80" height="80" rx="4" fill="#334155"/>
      <text x="60" y="55" font-size="10" fill="#94a3b8" text-anchor="middle">IMAGE</text>
      <text x="120" y="35" font-size="14" fill="#f1f5f9" font-weight="bold">Product Name</text>
      <text x="120" y="55" font-size="16" fill="#1a5632">Ksh 1,299</text>
      <rect x="120" y="70" width="100" height="25" rx="4" fill="#10b981"/>
      <text x="170" y="87" font-size="11" fill="white" text-anchor="middle" font-weight="bold">Add to Cart</text>
      <circle cx="280" cy="40" r="4" fill="#1a5632"/>
      <circle cx="295" cy="40" r="4" fill="#3b82f6"/>
      <circle cx="310" cy="40" r="4" fill="#10b981"/>
      <text x="280" y="60" font-size="10" fill="#94a3b8">Colors</text>
      <rect x="260" y="70" width="50" height="20" rx="4" fill="#334155"/>
      <text x="285" y="84" font-size="10" fill="#cbd5e1">S M L XL</text>
    </svg>`},{title:"Add to Cart",desc:'Select your size/color, then click "Add to Cart". Products stay in your cart even if you leave the site and return later.',svg:`<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="80" rx="8" fill="#f1f5f9" stroke="#cbd5e1"/>
      <rect x="20" y="25" width="36" height="36" rx="4" fill="#1a5632"/>
      <text x="38" y="47" font-size="12" fill="white" font-weight="bold">1</text>
      <text x="70" y="40" font-size="14" fill="#0f172a" font-weight="bold">Cart Updated</text>
      <text x="70" y="58" font-size="12" fill="#64748b">Product added successfully</text>
      <rect x="250" y="20" width="130" height="40" rx="6" fill="#1a5632"/>
      <text x="315" y="44" font-size="12" fill="white" text-anchor="middle" font-weight="bold">View Cart (1)</text>
    </svg>`},{title:"Checkout",desc:'Click "View Cart" then "Checkout". Enter your delivery location (Kericho town/county) and phone number. Confirm your order.',svg:`<svg viewBox="0 0 400 140" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="140" rx="8" fill="#1e293b"/>
      <text x="20" y="30" font-size="14" fill="#f1f5f9" font-weight="bold">Delivery Details</text>
      <rect x="20" y="40" width="360" height="30" rx="4" fill="#334155"/>
      <text x="30" y="58" font-size="12" fill="#94a3b8">Kericho Town, Phone number</text>
      <text x="40" y="90" font-size="13" fill="#f1f5f9">Payment Method:</text>
      <rect x="40" y="100" width="100" height="25" rx="4" fill="#10b981"/>
      <text x="90" y="117" font-size="11" fill="white" text-anchor="middle" font-weight="bold">M-Pesa</text>
      <rect x="150" y="100" width="100" height="25" rx="4" fill="#334155"/>
      <text x="200" y="117" font-size="11" fill="#cbd5e1" text-anchor="middle">Cash on Delivery</text>
      <rect x="270" y="100" width="100" height="25" rx="4" fill="#334155"/>
      <text x="320" y="117" font-size="11" fill="#cbd5e1" text-anchor="middle">Bank Transfer</text>
      <rect x="260" y="125" width="120" height="30" rx="6" fill="#1a5632"/>
      <text x="320" y="143" font-size="13" fill="white" text-anchor="middle" font-weight="bold">Place Order</text>
    </svg>`}];function h(){return e.jsxs(i,{title:"Shopping Guide",children:[e.jsx(o,{steps:x}),e.jsx("h3",{children:"Need Help?"}),e.jsx("p",{children:"If you have any questions while shopping, tap the green WhatsApp button at the bottom right of any page to chat with us instantly, or email omixsystems@gmail.com."})]})}const _=Object.freeze(Object.defineProperty({__proto__:null,default:h},Symbol.toStringTag,{value:"Module"})),c=[{title:"Request a Refund",desc:'Go to your Account > Orders, find the order and click "Request Refund". Explain the issue and upload a photo if item is damaged.',svg:`<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="100" rx="8" fill="#fef2f2"/>
      <rect x="20" y="20" width="120" height="60" rx="6" fill="#dc2626"/>
      <text x="80" y="50" font-size="14" fill="white" text-anchor="middle" font-weight="bold">Request Refund</text>
      <rect x="160" y="20" width="220" height="60" rx="6" fill="#fee2e2" stroke="#fecaca"/>
      <text x="180" y="40" font-size="12" fill="#7f1d1d">Reason:</text>
      <text x="180" y="58" font-size="11" fill="#991b1b">Damaged item / Wrong size</text>
      <text x="340" y="55" font-size="10" fill="#991b1b">+ Upload Photo</text>
    </svg>`},{title:"Refund Processing",desc:"Once approved (usually within 24 hours), refund is sent to your original payment method. M-Pesa refunds complete in 1-2 hours.",svg:`<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="80" rx="8" fill="#f0fdf4"/>
      <rect x="40" y="15" width="80" height="50" rx="6" fill="#22c55e"/>
      <text x="80" y="45" font-size="12" fill="white" text-anchor="middle" font-weight="bold">Approved</text>
      <path d="M130 40l15 15 40-40" stroke="#22c55e" stroke-width="3" stroke-linecap="round"/>
      <rect x="180" y="15" width="100" height="50" rx="6" fill="#10b981"/>
      <text x="230" y="42" font-size="12" fill="white" text-anchor="middle" font-weight="bold">Ksh 1,299</text>
      <text x="230" y="58" font-size="10" fill="#d1fae5" text-anchor="middle">Refunded</text>
      <text x="320" y="45" font-size="11" fill="#16a34a">1-2 hours to M-Pesa</text>
    </svg>`}];function f(){return e.jsxs(i,{title:"How to Apply for a Refund",children:[e.jsx("p",{className:"mb-6 text-zinc-400",children:"We offer hassle-free refunds for eligible orders within 7 days of delivery."}),e.jsx(o,{steps:c}),e.jsx("h3",{children:"Eligibility"}),e.jsxs("ul",{children:[e.jsx("li",{children:"Damaged or defective items"}),e.jsx("li",{children:"Wrong item delivered"}),e.jsx("li",{children:"Significant difference from product description"}),e.jsx("li",{children:"Items must be unused and in original packaging"})]})]})}const O=Object.freeze(Object.defineProperty({__proto__:null,default:f},Symbol.toStringTag,{value:"Module"}));function w(){return e.jsxs(i,{title:"Dispute Resolution Policy",children:[e.jsx("h3",{children:"How Disputes Work"}),e.jsx("p",{children:"If you receive a damaged item, wrong product, or have any issue with your order, follow this 4-step process:"}),e.jsxs("ol",{children:[e.jsx("li",{children:"Contact us within 48 hours of delivery via WhatsApp or email"}),e.jsx("li",{children:"Provide your order number and clear photos of the issue"}),e.jsx("li",{children:"Our team investigates and offers a solution within 24 hours"}),e.jsx("li",{children:"Accept the solution or escalate to dispute mediation"})]}),e.jsx("h3",{children:"Common Solutions"}),e.jsxs("ul",{children:[e.jsx("li",{children:"Full refund to original payment method"}),e.jsx("li",{children:"Replacement of the item"}),e.jsx("li",{children:"Partial refund for minor issues"}),e.jsx("li",{children:"Coupon for future purchase"})]}),e.jsx("h3",{children:"Mediation"}),e.jsx("p",{children:"If you disagree with our initial resolution, we can arrange independent mediation through Kericho Consumer Affairs or a neutral third party."})]})}const M=Object.freeze(Object.defineProperty({__proto__:null,default:w},Symbol.toStringTag,{value:"Module"}));function y(){return e.jsxs(i,{title:"After Sale Policy",children:[e.jsx("h3",{children:"Warranty"}),e.jsx("p",{children:"All products come with a 7-day warranty against manufacturing defects. If the item stops working due to no fault of your own, we will replace it or issue a refund."}),e.jsx("h3",{children:"Returns"}),e.jsx("p",{children:"Items can be returned within 7 days of delivery if they are unused, in original packaging, and have the receipt. Contact us to initiate a return."}),e.jsx("h3",{children:"Exchanges"}),e.jsx("p",{children:"For size issues or wrong color delivered, we offer free exchanges within Kericho. For upcountry orders, shipping costs may apply."}),e.jsx("h3",{children:"Support Hours"}),e.jsx("p",{children:"Our support team is available Monday to Saturday, 8 AM to 8 PM via WhatsApp and email."})]})}const C=Object.freeze(Object.defineProperty({__proto__:null,default:y},Symbol.toStringTag,{value:"Module"})),g=[{title:"Delivery Process",desc:"After payment confirmation, we prepare your order within 2 hours. A rider picks up and delivers to your address in Kericho.",svg:`<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="100" rx="8" fill="#f0f9ff"/>
      <rect x="20" y="20" width="80" height="60" rx="6" fill="#0ea5e9"/>
      <text x="60" y="45" font-size="12" fill="white" text-anchor="middle">Prep</text>
      <text x="60" y="62" font-size="10" fill="#bae6fd" text-anchor="middle">2 hours</text>
      <path d="M100 50l30 0" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4,4"/>
      <rect x="140" y="20" width="80" height="60" rx="6" fill="#3b82f6"/>
      <text x="180" y="45" font-size="12" fill="white" text-anchor="middle">Pick Up</text>
      <text x="180" y="62" font-size="10" fill="#bfdbfe" text-anchor="middle">Rider</text>
      <path d="M220 50l30 0" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4,4"/>
      <rect x="260" y="20" width="80" height="60" rx="6" fill="#10b981"/>
      <text x="300" y="45" font-size="12" fill="white" text-anchor="middle">Deliver</text>
      <text x="300" y="62" font-size="10" fill="#d1fae5" text-anchor="middle">Kericho</text>
    </svg>`},{title:"Shipping Rates",desc:"Delivery within Kericho town is free. Upcountry locations have a flat rate of Ksh 150-300 depending on distance.",svg:`<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="80" rx="8" fill="#ecfdf5"/>
      <rect x="20" y="15" width="120" height="50" rx="6" fill="#10b981"/>
      <text x="80" y="40" font-size="14" fill="white" text-anchor="middle" font-weight="bold">FREE</text>
      <text x="80" y="58" font-size="10" fill="#d1fae5" text-anchor="middle">Kericho Town</text>
      <rect x="160" y="15" width="120" height="50" rx="6" fill="#3b82f6"/>
      <text x="220" y="40" font-size="14" fill="white" text-anchor="middle" font-weight="bold">Ksh 150</text>
      <text x="220" y="58" font-size="10" fill="#bfdbfe" text-anchor="middle">County</text>
      <rect x="300" y="15" width="80" height="50" rx="6" fill="#f59e0b"/>
      <text x="340" y="40" font-size="14" fill="white" text-anchor="middle" font-weight="bold">Ksh 300</text>
      <text x="340" y="58" font-size="10" fill="#fef3c7" text-anchor="middle">Upcountry</text>
    </svg>`}];function m(){return e.jsxs(i,{title:"Delivery and Shipping",children:[e.jsx("p",{className:"mb-6 text-zinc-400",children:"We deliver across Kericho county and select upcountry locations."}),e.jsx(o,{steps:g})]})}const D=Object.freeze(Object.defineProperty({__proto__:null,default:m},Symbol.toStringTag,{value:"Module"})),u=[{title:"Do I need an account to shop?",desc:"No. You can browse and add items to cart without an account. But you need to sign up to place an order.",svg:`<svg viewBox="0 0 400 60" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="60" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>
      <text x="40" y="38" font-size="14" fill="#0f172a">Browse &gt; Add to Cart &gt;</text>
      <rect x="180" y="15" width="90" height="30" rx="6" fill="#1a5632"/>
      <text x="225" y="34" font-size="12" fill="white" text-anchor="middle" font-weight="bold">Sign Up</text>
      <text x="300" y="38" font-size="14" fill="#0f172a">to Order</text>
    </svg>`},{title:"What payment methods do you accept?",desc:"M-Pesa STK push is our main method. We also accept Paybill, Bank Transfer, and Cash on Delivery in Kericho town.",svg:`<svg viewBox="0 0 400 70" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="70" rx="8" fill="#f1f5f9" stroke="#cbd5e1"/>
      <rect x="20" y="15" width="80" height="40" rx="6" fill="#10b981"/>
      <text x="60" y="38" font-size="10" fill="white" text-anchor="middle" font-weight="bold">M-Pesa</text>
      <rect x="110" y="15" width="80" height="40" rx="6" fill="#3b82f6"/>
      <text x="150" y="38" font-size="10" fill="white" text-anchor="middle" font-weight="bold">Paybill</text>
      <rect x="200" y="15" width="80" height="40" rx="6" fill="#f59e0b"/>
      <text x="240" y="38" font-size="10" fill="white" text-anchor="middle" font-weight="bold">Bank</text>
      <rect x="290" y="15" width="80" height="40" rx="6" fill="#8b5cf6"/>
      <text x="330" y="38" font-size="10" fill="white" text-anchor="middle" font-weight="bold">COD</text>
    </svg>`},{title:"How do I track my order?",desc:"Log in to your account, go to Order History, and click any order to see status (Preparing, In Transit, Delivered).",svg:`<svg viewBox="0 0 400 70" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="70" rx="8" fill="#ecfdf5"/>
      <rect x="20" y="15" width="100" height="40" rx="6" fill="#22c55e"/>
      <text x="70" y="38" font-size="10" fill="white" text-anchor="middle">Delivered</text>
      <rect x="130" y="15" width="100" height="40" rx="6" fill="#3b82f6"/>
      <text x="180" y="38" font-size="10" fill="white" text-anchor="middle">In Transit</text>
      <rect x="240" y="15" width="100" height="40" rx="6" fill="#f59e0b"/>
      <text x="290" y="38" font-size="10" fill="white" text-anchor="middle">Preparing</text>
    </svg>`}];function p(){return e.jsxs(i,{title:"FAQ Center",children:[e.jsx("p",{className:"mb-8 text-zinc-400",children:"Quick answers to the most common questions."}),e.jsx(o,{steps:u}),e.jsx("h3",{children:"More Questions?"}),e.jsx("p",{children:"If you cannot find your answer here, contact us via WhatsApp at 254768213649 or email omixsystems@gmail.com. We respond within 24 hours."})]})}const B=Object.freeze(Object.defineProperty({__proto__:null,default:p},Symbol.toStringTag,{value:"Module"})),b=[{title:"M-Pesa (Recommended)",desc:"Select M-Pesa, enter your phone number, confirm the STK prompt with your PIN, and receive instant order confirmation.",svg:`<svg viewBox="0 0 400 160" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="160" rx="8" fill="#1e293b"/>
      <text x="20" y="30" font-size="14" fill="#f1f5f9" font-weight="bold">M-Pesa Checkout</text>
      <rect x="20" y="40" width="360" height="40" rx="4" fill="#334155"/>
      <text x="30" y="62" font-size="12" fill="#94a3b8">Phone: 07XXXXXXXX</text>
      <rect x="20" y="90" width="360" height="40" rx="4" fill="#10b981"/>
      <text x="200" y="114" font-size="13" fill="white" text-anchor="middle" font-weight="bold">Pay Ksh 1,299</text>
      <text x="200" y="135" font-size="10" fill="#94a3b8" text-anchor="middle">Enter M-Pesa PIN when prompt appears</text>
      <!-- Phone notification -->
      <rect x="280" y="10" width="110" height="60" rx="6" fill="#0f172a" stroke="#334155"/>
      <text x="335" y="25" font-size="9" fill="#f1f5f9" text-anchor="middle">Safaricom</text>
      <text x="335" y="40" font-size="10" fill="#f1f5f9" text-anchor="middle">Confirm KES 1,299</text>
      <text x="335" y="52" font-size="9" fill="#94a3b8" text-anchor="middle">Enter PIN > _____</text>
    </svg>`},{title:"Paybill Option",desc:"Go to M-Pesa > Paybill, enter our business number, your order number as account, amount, and confirm with PIN.",svg:`<svg viewBox="0 0 400 120" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="120" rx="8" fill="#f1f5f9" stroke="#cbd5e1"/>
      <text x="20" y="25" font-size="12" fill="#0f172a" font-weight="bold">M-Pesa Menu</text>
      <rect x="20" y="35" width="120" height="30" rx="4" fill="#10b981"/>
      <text x="80" y="53" font-size="12" fill="white" text-anchor="middle" font-weight="bold">Paybill</text>
      <rect x="150" y="35" width="120" height="30" rx="4" fill="#334155"/>
      <text x="210" y="53" font-size="12" fill="#cbd5e1" text-anchor="middle">Buy Goods</text>
      <rect x="20" y="75" width="360" height="35" rx="4" fill="#ffffff"/>
      <text x="60" y="95" font-size="11" fill="#0f172a">Biz No: 4XXXXXXX</text>
      <text x="180" y="95" font-size="11" fill="#0f172a">Acc: #ORD1234</text>
      <text x="280" y="95" font-size="11" fill="#0f172a">Ksh 1,299</text>
    </svg>`},{title:"Cash on Delivery",desc:"Available within Kericho town only. No upfront payment required. Pay cash to the delivery person when your order arrives.",svg:`<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="100" rx="8" fill="#ecfdf5"/>
      <rect x="20" y="20" width="360" height="60" rx="6" fill="#10b981"/>
      <text x="200" y="50" font-size="14" fill="white" text-anchor="middle" font-weight="bold">Cash on Delivery</text>
      <text x="200" y="72" font-size="11" fill="white" text-anchor="middle">Available in Kericho Town</text>
      <text x="200" y="35" font-size="12" fill="white" text-anchor="middle">+ Ksh 50 convenience fee</text>
    </svg>`}];function v(){return e.jsxs(i,{title:"How Do I Pay on Omix Store",children:[e.jsx("p",{className:"mb-6 text-zinc-400",children:"We accept multiple payment methods to make checkout as convenient as possible."}),e.jsx(o,{steps:b}),e.jsx("h3",{children:"After Payment"}),e.jsx("p",{children:"Once your payment is confirmed, you will receive an order confirmation on WhatsApp or email. Your order will be prepared for delivery and you can track its status in your account dashboard."})]})}const K=Object.freeze(Object.defineProperty({__proto__:null,default:v},Symbol.toStringTag,{value:"Module"})),z=[{title:"Orders Within Kericho Town",desc:"Same-day or next-day delivery. Orders placed before 2 PM get delivered same day. After 2 PM, delivery is next day.",svg:`<svg viewBox="0 0 400 100" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="100" rx="8" fill="#eff6ff"/>
      <rect x="20" y="20" width="160" height="60" rx="6" fill="#3b82f6"/>
      <text x="100" y="45" font-size="14" fill="white" text-anchor="middle" font-weight="bold">Kericho Town</text>
      <text x="100" y="65" font-size="12" fill="white" text-anchor="middle">Same day / Next day</text>
      <rect x="200" y="20" width="180" height="60" rx="6" fill="#dbeafe"/>
      <text x="290" y="45" font-size="11" fill="#1e40af">2 PM cutoff for same day</text>
      <text x="290" y="65" font-size="11" fill="#1e40af">After 2 PM = next day</text>
    </svg>`},{title:"Orders Outside Kericho Town",desc:"3-7 business days depending on your location. We partner with local courier services for county-wide delivery.",svg:`<svg viewBox="00 0 400 120" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="120" rx="8" fill="#fff7ed"/>
      <rect x="20" y="20" width="360" height="80" rx="6" fill="#f97316"/>
      <text x="200" y="45" font-size="14" fill="white" text-anchor="middle" font-weight="bold">Upcountry Delivery</text>
      <text x="200" y="65" font-size="12" fill="white" text-anchor="middle">3-7 business days</text>
      <text x="200" y="88" font-size="11" fill="#fed7aa" text-anchor="middle">Bomet, Kakamega, Eldoret, Nairobi, Mombasa</text>
    </svg>`},{title:"Track Your Order",desc:"Log in to your account to see order status updates. You will also receive SMS notifications on delivery progress.",svg:`<svg viewBox="0 0 400 90" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="90" rx="8" fill="#f3e8ff"/>
      <rect x="20" y="15" width="120" height="60" rx="6" fill="#8b5cf6"/>
      <text x="80" y="40" font-size="12" fill="white" text-anchor="middle" font-weight="bold">Preparing</text>
      <rect x="140" y="15" width="120" height="60" rx="6" fill="#3b82f6"/>
      <text x="200" y="40" font-size="12" fill="white" text-anchor="middle" font-weight="bold">In Transit</text>
      <rect x="260" y="15" width="120" height="60" rx="6" fill="#10b981"/>
      <text x="320" y="40" font-size="12" fill="white" text-anchor="middle" font-weight="bold">Delivered</text>
    </svg>`}];function j(){return e.jsxs(i,{title:"How Long Does My Order Arrive",children:[e.jsx("p",{className:"mb-6 text-zinc-400",children:"Delivery times depend on your location and order time."}),e.jsx(o,{steps:z})]})}const R=Object.freeze(Object.defineProperty({__proto__:null,default:j},Symbol.toStringTag,{value:"Module"})),S=[{title:"What Are Flash Sales?",desc:"Limited-time deals where selected products are heavily discounted for a short period. Usually 24-48 hours.",svg:`<svg viewBox="0 0 400 80" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="80" rx="8" fill="#fef2f2"/>
      <rect x="20" y="15" width="120" height="50" rx="6" fill="#dc2626"/>
      <text x="80" y="42" font-size="14" fill="white" text-anchor="middle" font-weight="bold">FLASH SALE</text>
      <text x="80" y="58" font-size="10" fill="#fecaca" text-anchor="middle">24-48 hours</text>
      <rect x="160" y="15" width="100" height="50" rx="6" fill="#fee2e2"/>
      <text x="210" y="40" font-size="28" fill="#dc2626" text-anchor="middle" font-weight="bold">50%</text>
      <text x="210" y="58" font-size="10" fill="#ea580c" text-anchor="middle">OFF</text>
      <rect x="280" y="15" width="100" height="50" rx="6" fill="#eff6ff"/>
      <text x="330" y="40" font-size="12" fill="#3b82f6" text-anchor="middle" font-weight="bold">5 left</text>
      <text x="330" y="58" font-size="10" fill="#64748b" text-anchor="middle">Hurry!</text>
    </svg>`},{title:"How to Get Flash Sale Items",desc:'Spot the red "FLASH SALE" badge on products. Add to cart immediately and checkout within 2 hours to guarantee the discount.',svg:`<svg viewBox="0 0 400 90" xmlns="http://www.w3.org/2000/svg" class="w-full">
      <rect x="0" y="0" width="400" height="90" rx="8" fill="#fffbeb"/>
      <rect x="20" y="15" width="360" height="60" rx="6" fill="#fef3c7" stroke="#fbbf24"/>
      <rect x="30" y="25" width="60" height="40" rx="4" fill="#f59e0b"/>
      <text x="60" y="48" font-size="10" fill="white" text-anchor="middle" font-weight="bold">NEW</text>
      <rect x="100" y="25" width="70" height="40" rx="4" fill="#dc2626"/>
      <text x="135" y="48" font-size="9" fill="white" text-anchor="middle" font-weight="bold">FLASH SALE</text>
      <text x="180" y="50" font-size="14" fill="#0f172a" font-weight="bold">Product Name</text>
      <text x="320" y="50" font-size="12" fill="#ea580c" font-weight="bold">Ksh 999</text>
      <text x="340" y="65" font-size="10" fill="#94a3b8" style="text-decoration:line-through">Ksh 1,999</text>
      <rect x="270" y="55" width="95" height="25" rx="6" fill="#1a5632"/>
      <text x="317" y="71" font-size="11" fill="white" text-anchor="middle" font-weight="bold">Add to Cart</text>
    </svg>`}];function P(){return e.jsxs(i,{title:"Flash Sale",children:[e.jsx("p",{className:"mb-6 text-zinc-400",children:"Grab incredible deals before they are gone."}),e.jsx(o,{steps:S})]})}const T=Object.freeze(Object.defineProperty({__proto__:null,default:P},Symbol.toStringTag,{value:"Module"}));export{C as A,M as D,B as F,A as H,K as P,O as R,_ as S,D as a,R as b,T as c};
