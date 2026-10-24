export const AFTER_SALES_QUEUE_NAME = "after-sales-milestone-v1";
export type AfterSalesMilestoneJob =
  | {
      outboxEventId: number;
      jobType?: "MILESTONE";
      itemId: number;
      itemVersion: number;
      milestone: "REMIND_72H" | "REMIND_144H" | "AUTO_CLOSE_168H";
    }
  | {
      outboxEventId: number;
      jobType: "ATTACHMENT_DELETE";
      attachmentId: number;
    };
