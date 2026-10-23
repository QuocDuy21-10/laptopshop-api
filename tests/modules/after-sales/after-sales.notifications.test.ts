import { recipientsFor } from "modules/after-sales/after-sales.notifications";

describe("after-sales notification policy", () => {
  it("notifies the assignee for customer activity", () => {
    expect(recipientsFor({ event: "CUSTOMER_MESSAGE", customerId: 11, assigneeId: 7 })).toEqual([
      7,
    ]);
    expect(recipientsFor({ event: "CUSTOMER_MESSAGE", customerId: 11, assigneeId: null })).toEqual(
      [],
    );
  });

  it("notifies the customer for admin updates", () => {
    expect(recipientsFor({ event: "ADMIN_STATUS", customerId: 11, assigneeId: 7 })).toEqual([11]);
  });

  it("does not notify customers for internal notes", () => {
    expect(recipientsFor({ event: "INTERNAL_NOTE", customerId: 11, assigneeId: 7 })).toEqual([]);
  });
});
