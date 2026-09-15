import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PERMISSIONS } from "../lib/permissions";

const db = new PrismaClient();

const DEMO_PASSWORD = "Password123!";

async function hash(pw: string) {
  return bcrypt.hash(pw, 10);
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function randomItem<T>(arr: T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (item === undefined) throw new Error("randomItem called on empty array");
  return item;
}

async function main() {
  console.log("Seeding demo data (clearly marked as demo below)…");

  // -------------------------------------------------------------------
  // Global reference data
  // -------------------------------------------------------------------
  for (const p of PERMISSIONS) {
    await db.permission.upsert({ where: { key: p.key }, create: p, update: { label: p.label, category: p.category } });
  }

  // -------------------------------------------------------------------
  // Platform admin
  // -------------------------------------------------------------------
  const platformAdminEmail = "platform-admin@example.com";
  const existingPlatformAdmin = await db.user.findFirst({ where: { email: platformAdminEmail, role: "PLATFORM_ADMIN" } });
  if (!existingPlatformAdmin) {
    await db.user.create({ data: { email: platformAdminEmail, passwordHash: await hash(DEMO_PASSWORD), role: "PLATFORM_ADMIN" } });
  }

  // -------------------------------------------------------------------
  // Tenant
  // -------------------------------------------------------------------
  const slug = "riverside-wellness";
  let tenant = await db.tenant.findUnique({ where: { slug } });
  if (tenant) {
    console.log("Tenant already exists — wiping its data for a clean reseed.");
    await db.tenant.delete({ where: { slug } });
  }

  tenant = await db.tenant.create({
    data: {
      slug,
      name: "Riverside Wellness Clinic",
      status: "ACTIVE",
      subscriptionStatus: "ACTIVE",
      branding: {
        create: {
          businessName: "Riverside Wellness Clinic",
          primaryColor: "#0f766e",
          secondaryColor: "#0891b2",
          accentColor: "#f59e0b",
          contactEmail: "hello@example.com",
          contactPhone: "+1 (555) 010-2200",
          addressLine1: "128 Riverside Ave",
          city: "Springfield",
          region: "IL",
          postalCode: "62701",
          country: "USA",
          website: "https://example.com",
          currency: "USD",
          timeZone: "America/Chicago",
          termsContent: "Demo terms & conditions for Riverside Wellness Clinic.",
          privacyContent: "Demo privacy policy for Riverside Wellness Clinic.",
          cancellationPolicy: "Please cancel or reschedule at least 24 hours in advance.",
        },
      },
      settings: {
        create: {
          taxRateBasisPoints: 725,
          appointmentCancellationHours: 24,
          appointmentReminderHours: 24,
          membershipMaxPauseMonths: 2,
          publiclyListed: true,
        },
      },
    },
  });
  const tenantId = tenant.id;

  const mainLocation = await db.location.create({
    data: {
      tenantId,
      name: "Riverside Main Clinic",
      addressLine1: "128 Riverside Ave",
      city: "Springfield",
      region: "IL",
      postalCode: "62701",
      country: "USA",
      phone: "+1 (555) 010-2200",
      isPrimary: true,
    },
  });
  const downtownLocation = await db.location.create({
    data: {
      tenantId,
      name: "Downtown Annex",
      addressLine1: "45 Market St",
      city: "Springfield",
      region: "IL",
      postalCode: "62704",
      country: "USA",
      phone: "+1 (555) 010-2255",
    },
  });

  // -------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------
  const allPermissions = await db.permission.findMany();
  const frontDeskRole = await db.role.create({ data: { tenantId, name: "Front Desk" } });
  await db.rolePermission.createMany({
    data: allPermissions
      .filter((p) => ["customers.view", "appointments.manage", "sales.manage", "messages.send"].includes(p.key))
      .map((p) => ({ roleId: frontDeskRole.id, permissionId: p.id })),
  });
  const practitionerRole = await db.role.create({ data: { tenantId, name: "Practitioner" } });
  await db.rolePermission.createMany({
    data: allPermissions
      .filter((p) => ["customers.view", "appointments.manage", "loyalty.adjust"].includes(p.key))
      .map((p) => ({ roleId: practitionerRole.id, permissionId: p.id })),
  });
  const managerRole = await db.role.create({ data: { tenantId, name: "Manager" } });
  await db.rolePermission.createMany({ data: allPermissions.map((p) => ({ roleId: managerRole.id, permissionId: p.id })) });

  // -------------------------------------------------------------------
  // Clinic admin + staff
  // -------------------------------------------------------------------
  const adminUser = await db.user.create({
    data: { tenantId, email: "clinic-admin@example.com", passwordHash: await hash(DEMO_PASSWORD), role: "TENANT_ADMIN" },
  });
  await db.staffProfile.create({
    data: { tenantId, userId: adminUser.id, firstName: "Jordan", lastName: "Reyes", title: "Clinic Director", active: true, activatedAt: new Date() },
  });

  const staffSeed = [
    { firstName: "Alex", lastName: "Kim", title: "Physical Therapist", role: practitionerRole.id, email: "alex.kim@example.com" },
    { firstName: "Morgan", lastName: "Patel", title: "Massage Therapist", role: practitionerRole.id, email: "morgan.patel@example.com" },
    { firstName: "Sam", lastName: "Nguyen", title: "Nutritionist", role: practitionerRole.id, email: "sam.nguyen@example.com" },
    { firstName: "Taylor", lastName: "Brooks", title: "Front Desk Coordinator", role: frontDeskRole.id, email: "taylor.brooks@example.com" },
  ];
  const staffProfiles = [];
  for (const s of staffSeed) {
    const u = await db.user.create({ data: { tenantId, email: s.email, passwordHash: await hash(DEMO_PASSWORD), role: "STAFF" } });
    const sp = await db.staffProfile.create({
      data: { tenantId, userId: u.id, firstName: s.firstName, lastName: s.lastName, title: s.title, roleId: s.role, active: true, activatedAt: new Date() },
    });
    for (const day of [1, 2, 3, 4, 5]) {
      await db.staffAvailability.create({
        data: { tenantId, staffProfileId: sp.id, dayOfWeek: day, startMinute: 9 * 60, endMinute: 17 * 60, breakStartMinute: 12 * 60, breakEndMinute: 13 * 60 },
      });
    }
    await db.staffLocation.create({ data: { staffProfileId: sp.id, locationId: mainLocation.id } });
    staffProfiles.push(sp);
  }

  // -------------------------------------------------------------------
  // Catalogue: services
  // -------------------------------------------------------------------
  const categoryDefs = [
    { name: "Consultations", services: [
      { name: "New Patient Consultation", duration: 45, price: 12000, desc: "Comprehensive initial assessment with a clinician." },
      { name: "Follow-up Consultation", duration: 20, price: 6000, desc: "Progress check-in with your practitioner." },
      { name: "Nutrition Consultation", duration: 30, price: 8500, desc: "Personalized dietary guidance." },
    ]},
    { name: "Physical Therapy", services: [
      { name: "Physical Therapy Session", duration: 60, price: 15000, desc: "One-on-one guided rehabilitation session." },
      { name: "Sports Injury Assessment", duration: 45, price: 13000, desc: "Evaluation and treatment plan for sports injuries." },
      { name: "Post-Surgical Rehab Session", duration: 60, price: 16000, desc: "Structured recovery support after surgery." },
    ]},
    { name: "Massage & Bodywork", services: [
      { name: "Swedish Massage (60 min)", duration: 60, price: 11000, desc: "Relaxing full-body massage." },
      { name: "Deep Tissue Massage (60 min)", duration: 60, price: 13000, desc: "Targeted therapeutic massage for chronic tension." },
      { name: "Prenatal Massage", duration: 45, price: 10500, desc: "Gentle massage tailored for expectant mothers." },
    ]},
    { name: "Wellness", services: [
      { name: "Acupuncture Session", duration: 45, price: 12500, desc: "Traditional acupuncture treatment." },
      { name: "Chiropractic Adjustment", duration: 30, price: 9000, desc: "Spinal alignment and mobility treatment." },
      { name: "Wellness Check-up", duration: 30, price: 7500, desc: "General wellness screening." },
      { name: "IV Hydration Therapy", duration: 40, price: 14000, desc: "Supervised IV hydration and nutrient therapy." },
    ]},
  ];

  const allServices: { id: string; name: string; durationMinutes: number }[] = [];
  for (const cat of categoryDefs) {
    const category = await db.serviceCategory.create({ data: { tenantId, name: cat.name } });
    for (const s of cat.services) {
      const service = await db.service.create({
        data: {
          tenantId,
          categoryId: category.id,
          name: s.name,
          description: s.desc,
          prepInstructions: "Please arrive 10 minutes early and wear comfortable clothing.",
          aftercareInstructions: "Stay hydrated and avoid strenuous activity for the rest of the day.",
          durationMinutes: s.duration,
          priceCents: s.price,
          taxable: true,
        },
      });
      allServices.push({ id: service.id, name: service.name, durationMinutes: service.durationMinutes });
      // assign 1-2 random staff to each service
      const assignees = [randomItem(staffProfiles), randomItem(staffProfiles)];
      const uniqueAssignees = [...new Map(assignees.map((a) => [a.id, a])).values()];
      for (const staff of uniqueAssignees) {
        await db.staffService.create({ data: { staffProfileId: staff.id, serviceId: service.id } }).catch(() => {});
      }
    }
  }

  // -------------------------------------------------------------------
  // Catalogue: products
  // -------------------------------------------------------------------
  const productCategory = await db.productCategory.create({ data: { tenantId, name: "Wellness Products" } });
  const productDefs = [
    { name: "Magnesium Recovery Balm", price: 2400, sku: "PRD-001", qty: 40 },
    { name: "Herbal Wellness Tea (Box of 20)", price: 1800, sku: "PRD-002", qty: 60 },
    { name: "Resistance Band Set", price: 2200, sku: "PRD-003", qty: 25 },
    { name: "Foam Roller", price: 3500, sku: "PRD-004", qty: 15 },
    { name: "Electrolyte Hydration Mix", price: 1600, sku: "PRD-005", qty: 50 },
    { name: "Aromatherapy Essential Oil Set", price: 3200, sku: "PRD-006", qty: 20 },
  ];
  const allProducts = [];
  for (const p of productDefs) {
    const product = await db.product.create({
      data: { tenantId, categoryId: productCategory.id, name: p.name, priceCents: p.price, sku: p.sku, inventoryQuantity: p.qty, taxable: true },
    });
    allProducts.push(product);
  }

  // -------------------------------------------------------------------
  // Packages
  // -------------------------------------------------------------------
  const packageDefs = [
    { name: "5-Session Physical Therapy Pack", uses: 5, price: 65000, expiry: 120, services: ["Physical Therapy Session"] },
    { name: "3-Session Massage Pack", uses: 3, price: 30000, expiry: 90, services: ["Swedish Massage (60 min)", "Deep Tissue Massage (60 min)"] },
    { name: "Wellness Starter Bundle", uses: 3, price: 24000, expiry: 60, services: ["Wellness Check-up", "Nutrition Consultation"] },
    { name: "10-Session Acupuncture Pack", uses: 10, price: 110000, expiry: 180, services: ["Acupuncture Session"] },
  ];
  const allPackages = [];
  for (const p of packageDefs) {
    const pkg = await db.package.create({
      data: { tenantId, name: p.name, totalUses: p.uses, priceCents: p.price, expiryDays: p.expiry, transferable: false },
    });
    for (const serviceName of p.services) {
      const svc = allServices.find((s) => s.name === serviceName);
      if (svc) await db.packageItem.create({ data: { packageId: pkg.id, serviceId: svc.id } });
    }
    allPackages.push(pkg);
  }

  // -------------------------------------------------------------------
  // Membership plans
  // -------------------------------------------------------------------
  const membershipPlan1 = await db.membershipPlan.create({
    data: {
      tenantId,
      name: "Wellness Essentials",
      description: "Monthly membership with account credit and service discounts.",
      billingFrequency: "MONTHLY",
      priceCents: 4900,
      includedCreditCents: 2000,
      serviceDiscountPercent: 10,
      pauseAllowed: true,
      maxPauseMonths: 2,
      cancellationPolicy: "Cancel anytime, effective at the end of the current billing period.",
    },
  });
  const membershipPlan2 = await db.membershipPlan.create({
    data: {
      tenantId,
      name: "Wellness Plus",
      description: "Enhanced monthly membership with priority booking.",
      billingFrequency: "MONTHLY",
      priceCents: 9900,
      includedCreditCents: 5000,
      serviceDiscountPercent: 15,
      productDiscountPercent: 10,
      priorityAccess: true,
      pauseAllowed: true,
      maxPauseMonths: 2,
      cancellationPolicy: "Cancel anytime, effective at the end of the current billing period.",
    },
  });
  const membershipPlan3 = await db.membershipPlan.create({
    data: {
      tenantId,
      name: "Annual Wellness Pass",
      description: "Best value annual membership.",
      billingFrequency: "ANNUAL",
      priceCents: 89000,
      includedCreditCents: 20000,
      serviceDiscountPercent: 20,
      productDiscountPercent: 10,
      priorityAccess: true,
      minimumCommitmentMonths: 12,
      pauseAllowed: false,
      cancellationPolicy: "Annual plans are non-refundable but may be cancelled for renewal purposes.",
    },
  });

  // -------------------------------------------------------------------
  // Loyalty
  // -------------------------------------------------------------------
  const loyaltyProgramme = await db.loyaltyProgramme.create({
    data: { tenantId, name: "Riverside Rewards", pointsPerCents: 0.01, pointsPerVisit: 5, referralPoints: 100, birthdayPoints: 50, pointsExpiryDays: 365 },
  });
  await Promise.all([
    db.loyaltyReward.create({ data: { tenantId, loyaltyProgrammeId: loyaltyProgramme.id, name: "$5 off your order", pointsCost: 100, rewardType: "DISCOUNT_AMOUNT", discountAmountCents: 500 } }),
    db.loyaltyReward.create({ data: { tenantId, loyaltyProgrammeId: loyaltyProgramme.id, name: "$15 off your order", pointsCost: 250, rewardType: "DISCOUNT_AMOUNT", discountAmountCents: 1500 } }),
    db.loyaltyReward.create({ data: { tenantId, loyaltyProgrammeId: loyaltyProgramme.id, name: "10% off your order", pointsCost: 200, rewardType: "DISCOUNT_PERCENT", discountPercent: 10 } }),
  ]);

  // -------------------------------------------------------------------
  // Customer tags
  // -------------------------------------------------------------------
  const vipTag = await db.customerTag.create({ data: { tenantId, name: "VIP", color: "#f59e0b" } });
  const newTag = await db.customerTag.create({ data: { tenantId, name: "New", color: "#0891b2" } });

  // -------------------------------------------------------------------
  // Customers (20+)
  // -------------------------------------------------------------------
  const firstNames = ["Emma", "Liam", "Olivia", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella", "Lucas", "Mia", "Logan", "Amelia", "James", "Harper", "Benjamin", "Evelyn", "Elijah", "Abigail", "Henry", "Ella", "Sebastian", "Scarlett", "Jack"];
  const lastNames = ["Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris"];

  const customers: { id: string; userId: string }[] = [];
  for (let i = 0; i < 24; i++) {
    const firstName = firstNames[i % firstNames.length]!;
    const lastName = lastNames[i % lastNames.length]!;
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;
    const user = await db.user.create({ data: { tenantId, email, passwordHash: await hash(DEMO_PASSWORD), role: "CUSTOMER" } });
    const profile = await db.customerProfile.create({
      data: {
        tenantId,
        userId: user.id,
        firstName,
        lastName,
        phone: `+1 (555) 01${(100 + i).toString().slice(-3)}-${(1000 + i * 7).toString().slice(-4)}`,
        marketingConsent: i % 3 !== 0,
        emailConsent: true,
        smsConsent: i % 2 === 0,
        preferredLocationId: i % 4 === 0 ? downtownLocation.id : mainLocation.id,
      },
    });
    if (i < 5) await db.customerProfileTag.create({ data: { customerProfileId: profile.id, tagId: vipTag.id } });
    if (i >= 20) await db.customerProfileTag.create({ data: { customerProfileId: profile.id, tagId: newTag.id } });
    customers.push({ id: profile.id, userId: user.id });
  }

  // -------------------------------------------------------------------
  // Leads
  // -------------------------------------------------------------------
  const leadDefs = [
    { name: "Priya Chandra", email: "priya.chandra@example.com", source: "Instagram", status: "NEW" as const },
    { name: "Marcus Webb", email: "marcus.webb@example.com", source: "Referral", status: "CONTACTED" as const },
    { name: "Grace Kim", email: "grace.kim@example.com", source: "Website", status: "QUALIFIED" as const },
    { name: "Devon Ellis", email: "devon.ellis@example.com", source: "Walk-in", status: "BOOKED" as const },
    { name: "Nina Osei", email: "nina.osei@example.com", source: "Google", status: "LOST" as const },
  ];
  for (const l of leadDefs) {
    await db.lead.create({
      data: {
        tenantId,
        name: l.name,
        email: l.email,
        source: l.source,
        status: l.status,
        assignedStaffProfileId: randomItem(staffProfiles).id,
        valueEstimateCents: 15000 + Math.floor(Math.random() * 30000),
        nextFollowUpAt: l.status !== "LOST" ? daysFromNow(3) : null,
        lastContactedAt: daysFromNow(-2),
      },
    });
  }

  // -------------------------------------------------------------------
  // Promotions
  // -------------------------------------------------------------------
  await db.promotion.create({
    data: {
      tenantId,
      title: "Welcome Offer",
      description: "10% off your first order.",
      startAt: daysFromNow(-30),
      endAt: daysFromNow(60),
      discountType: "PERCENT",
      discountValue: 10,
      code: "WELCOME10",
      perCustomerLimit: 1,
      customerSegment: "NEW",
      active: true,
    },
  });
  await db.promotion.create({
    data: {
      tenantId,
      title: "Spring Wellness Sale",
      description: "$15 off any package.",
      startAt: daysFromNow(-10),
      endAt: daysFromNow(20),
      discountType: "FIXED_AMOUNT",
      discountValue: 1500,
      code: "SPRING15",
      usageLimit: 100,
      customerSegment: "ALL",
      active: true,
    },
  });
  await db.promotion.create({
    data: {
      tenantId,
      title: "Winter Sale (Ended)",
      description: "Past seasonal promotion, kept for reporting history.",
      startAt: daysFromNow(-90),
      endAt: daysFromNow(-30),
      discountType: "PERCENT",
      discountValue: 15,
      code: "WINTER15",
      customerSegment: "ALL",
      active: false,
    },
  });

  // -------------------------------------------------------------------
  // Orders (various states)
  // -------------------------------------------------------------------
  const orderStatuses: Array<"PAID" | "PENDING" | "FAILED" | "REFUNDED"> = ["PAID", "PAID", "PAID", "PENDING", "FAILED", "REFUNDED"];
  for (let i = 0; i < 18; i++) {
    const customer = randomItem(customers);
    const status = orderStatuses[i % orderStatuses.length]!;
    const service = randomItem(allServices);
    const product = randomItem(allProducts);
    const subtotal = service.durationMinutes * 100 + product.priceCents;
    const tax = Math.round(subtotal * 0.0725);
    const total = subtotal + tax;

    const order = await db.order.create({
      data: {
        tenantId,
        customerProfileId: customer.id,
        orderNumber: `ORD-DEMO-${1000 + i}`,
        status,
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: total,
        placedAt: daysFromNow(-Math.floor(Math.random() * 60)),
        paidAt: status === "PAID" || status === "REFUNDED" ? daysFromNow(-Math.floor(Math.random() * 60)) : null,
        items: {
          create: [
            { itemType: "SERVICE", serviceId: service.id, name: service.name, quantity: 1, unitPriceCents: service.durationMinutes * 100, totalCents: service.durationMinutes * 100, taxCents: 0 },
            { itemType: "PRODUCT", productId: product.id, name: product.name, quantity: 1, unitPriceCents: product.priceCents, totalCents: product.priceCents, taxCents: 0 },
          ],
        },
      },
    });

    if (status !== "PENDING") {
      await db.payment.create({
        data: {
          tenantId,
          orderId: order.id,
          provider: "MOCK",
          providerPaymentId: `mock_pi_demo_${i}`,
          amountCents: total,
          status: status === "FAILED" ? "FAILED" : "SUCCEEDED",
          failureReason: status === "FAILED" ? "Your card was declined (simulated)." : null,
        },
      });
    }

    if (status === "PAID") {
      const points = Math.floor(total * 0.01);
      const profile = await db.customerProfile.findUnique({ where: { id: customer.id } });
      const newBalance = (profile?.loyaltyPointsBalance ?? 0) + points;
      await db.customerProfile.update({ where: { id: customer.id }, data: { loyaltyPointsBalance: newBalance } });
      await db.loyaltyTransaction.create({
        data: { tenantId, customerProfileId: customer.id, type: "EARNED", points, balanceAfter: newBalance, reason: "Earned from purchase", relatedOrderId: order.id },
      });
    }
  }

  // -------------------------------------------------------------------
  // Memberships (various states)
  // -------------------------------------------------------------------
  const membershipStates: Array<{ status: "ACTIVE" | "TRIAL" | "PAST_DUE" | "PAUSED" | "CANCELLED" | "EXPIRED"; plan: string }> = [
    { status: "ACTIVE", plan: membershipPlan1.id },
    { status: "ACTIVE", plan: membershipPlan2.id },
    { status: "ACTIVE", plan: membershipPlan1.id },
    { status: "TRIAL", plan: membershipPlan2.id },
    { status: "PAST_DUE", plan: membershipPlan1.id },
    { status: "PAUSED", plan: membershipPlan2.id },
    { status: "CANCELLED", plan: membershipPlan1.id },
    { status: "EXPIRED", plan: membershipPlan3.id },
  ];
  for (let i = 0; i < membershipStates.length; i++) {
    const state = membershipStates[i]!;
    const customer = customers[i]!;
    const start = daysFromNow(-30);
    const membership = await db.customerMembership.create({
      data: {
        tenantId,
        customerProfileId: customer.id,
        membershipPlanId: state.plan,
        status: state.status,
        startedAt: start,
        currentPeriodStart: start,
        currentPeriodEnd: daysFromNow(1),
        nextBillingAt: state.status === "ACTIVE" ? daysFromNow(1) : null,
        pausedAt: state.status === "PAUSED" ? daysFromNow(-5) : null,
        resumesAt: state.status === "PAUSED" ? daysFromNow(25) : null,
        cancelledAt: state.status === "CANCELLED" ? daysFromNow(-2) : null,
        creditBalanceCents: 2000,
      },
    });
    await db.membershipBillingEvent.create({
      data: { tenantId, customerMembershipId: membership.id, type: "CHARGE", amountCents: 4900, description: "Monthly billing", occurredAt: start },
    });
  }

  // -------------------------------------------------------------------
  // Appointments (various states, past and future)
  // -------------------------------------------------------------------
  const apptStatuses: Array<"REQUESTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW"> = ["CONFIRMED", "CONFIRMED", "COMPLETED", "COMPLETED", "CANCELLED", "NO_SHOW", "REQUESTED"];
  for (let i = 0; i < 25; i++) {
    const customer = randomItem(customers);
    const staff = randomItem(staffProfiles);
    const service = randomItem(allServices);
    const status = apptStatuses[i % apptStatuses.length]!;
    const isPast = status === "COMPLETED" || status === "CANCELLED" || status === "NO_SHOW";
    const dayOffset = isPast ? -Math.floor(Math.random() * 30) - 1 : Math.floor(Math.random() * 14) + 1;
    const startAt = daysFromNow(dayOffset);
    startAt.setHours(9 + (i % 8), i % 2 === 0 ? 0 : 30, 0, 0);
    const endAt = new Date(startAt.getTime() + service.durationMinutes * 60000);

    await db.appointment.create({
      data: {
        tenantId,
        customerProfileId: customer.id,
        serviceId: service.id,
        staffProfileId: staff.id,
        locationId: mainLocation.id,
        startAt,
        endAt,
        status,
        cancelledAt: status === "CANCELLED" ? startAt : null,
        cancelledBy: status === "CANCELLED" ? "CUSTOMER" : null,
      },
    });
  }

  // -------------------------------------------------------------------
  // Notification campaigns
  // -------------------------------------------------------------------
  const sentCampaign = await db.notificationCampaign.create({
    data: {
      tenantId,
      name: "Spring Sale Announcement",
      channel: "EMAIL",
      segment: "ALL",
      subject: "Save on your next visit",
      body: "Enjoy $15 off any package this spring with code SPRING15.",
      status: "SENT",
      sentAt: daysFromNow(-5),
      createdByStaffProfileId: staffProfiles[0]!.id,
    },
  });
  for (const customer of customers.slice(0, 10)) {
    await db.notificationDelivery.create({
      data: { tenantId, campaignId: sentCampaign.id, customerProfileId: customer.id, channel: "EMAIL", status: "DELIVERED", sentAt: daysFromNow(-5), deliveredAt: daysFromNow(-5) },
    });
  }
  await db.notificationCampaign.create({
    data: {
      tenantId,
      name: "New Service Launch (Draft)",
      channel: "IN_APP",
      segment: "MEMBERS",
      body: "We've just added IV Hydration Therapy — book your session today!",
      status: "DRAFT",
      createdByStaffProfileId: staffProfiles[0]!.id,
    },
  });

  for (const customer of customers.slice(0, 6)) {
    await db.notification.create({
      data: { tenantId, customerProfileId: customer.id, title: "Welcome to Riverside Rewards", body: "You're now earning points on every purchase.", type: "LOYALTY" },
    });
  }

  // -------------------------------------------------------------------
  // Conversations & messages
  // -------------------------------------------------------------------
  for (const customer of customers.slice(0, 5)) {
    const conversation = await db.conversation.create({
      data: { tenantId, customerProfileId: customer.id, channel: "IN_APP", status: "OPEN", assignedStaffProfileId: staffProfiles[3]!.id },
    });
    await db.message.create({ data: { tenantId, conversationId: conversation.id, senderType: "CUSTOMER", body: "Hi, can I ask about your cancellation policy?" } });
    await db.message.create({
      data: { tenantId, conversationId: conversation.id, senderType: "STAFF", senderStaffProfileId: staffProfiles[3]!.id, body: "Of course! You can reschedule or cancel up to 24 hours before your appointment at no charge." },
    });
  }

  // -------------------------------------------------------------------
  // Audit log samples
  // -------------------------------------------------------------------
  await db.auditLog.create({
    data: { tenantId, actorType: "SYSTEM", action: "seed.completed", entityType: "Tenant", entityId: tenantId, metadata: { note: "Demo data seeded" } },
  });

  console.log("Seed complete.");
  console.log(`Tenant workspace: ${slug}`);
  console.log(`Platform admin: ${platformAdminEmail} / ${DEMO_PASSWORD}`);
  console.log(`Clinic admin: clinic-admin@example.com / ${DEMO_PASSWORD}`);
  console.log(`Staff: alex.kim@example.com (and others) / ${DEMO_PASSWORD}`);
  console.log(`Sample customer: ${firstNames[0]!.toLowerCase()}.${lastNames[0]!.toLowerCase()}0@example.com / ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
