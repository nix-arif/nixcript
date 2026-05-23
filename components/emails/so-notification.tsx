import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

export type SoNotificationType = "submitted" | "approved" | "rejected" | "recalled";

interface SoNotificationEmailProps {
  type: SoNotificationType;
  soNo: string;
  customerName?: string;
  grandTotal?: string;
  recipientName?: string;
  actorName?: string;
  link: string;
}

const CONFIG: Record<SoNotificationType, { subject: string; heading: string; preview: string; color: string }> = {
  submitted: {
    subject: "Sales Order Pending Approval",
    heading: "Sales order pending your approval",
    preview: "A sales order has been submitted and requires your approval",
    color: "#2563eb",
  },
  approved: {
    subject: "Sales Order Approved",
    heading: "Your sales order has been approved",
    preview: "Your sales order has been approved and is now confirmed",
    color: "#16a34a",
  },
  rejected: {
    subject: "Sales Order Returned for Revision",
    heading: "Sales order returned for revision",
    preview: "Your sales order has been returned and requires revision",
    color: "#dc2626",
  },
  recalled: {
    subject: "Sales Order Recalled",
    heading: "Sales order has been recalled",
    preview: "A confirmed sales order has been recalled back to draft",
    color: "#d97706",
  },
};

const BODY_TEXT: Record<SoNotificationType, (props: SoNotificationEmailProps) => string> = {
  submitted: ({ soNo, actorName, customerName }) =>
    `${actorName ? `${actorName} has` : "A user has"} submitted sales order ${soNo}${customerName ? ` for ${customerName}` : ""} for approval. Please review and take action.`,
  approved: ({ soNo, actorName }) =>
    `Your sales order ${soNo} has been approved${actorName ? ` by ${actorName}` : ""}. It is now confirmed and ready to proceed.`,
  rejected: ({ soNo, actorName }) =>
    `Your sales order ${soNo} has been returned for revision${actorName ? ` by ${actorName}` : ""}. Please review and resubmit when ready.`,
  recalled: ({ soNo, actorName }) =>
    `Sales order ${soNo} has been recalled${actorName ? ` by ${actorName}` : ""} and returned to draft status.`,
};

const SoNotificationEmail = (props: SoNotificationEmailProps) => {
  const cfg = CONFIG[props.type];
  const bodyText = BODY_TEXT[props.type](props);

  return (
    <Html dir="ltr" lang="en">
      <Tailwind>
        <Head />
        <Preview>{cfg.preview}</Preview>
        <Body className="bg-gray-100 py-[40px] font-sans">
          <Container className="mx-auto max-w-[600px] rounded-[8px] bg-white p-[40px] shadow-sm">
            <Section className="mb-[32px]">
              <div
                style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: cfg.color, display: "inline-block", marginRight: 10 }}
              />
              <Heading className="m-0 mb-[8px] font-bold text-[24px] text-gray-900 inline">
                {cfg.heading}
              </Heading>
            </Section>

            <Section className="mb-[32px]">
              {props.recipientName && (
                <Text className="m-0 mb-[12px] text-[16px] text-gray-700">
                  Hi {props.recipientName},
                </Text>
              )}
              <Text className="m-0 mb-[16px] text-[16px] text-gray-700">{bodyText}</Text>
            </Section>

            <Section className="mb-[32px] rounded-[8px] bg-gray-50 p-[20px]">
              <Text className="m-0 mb-[6px] text-[14px] text-gray-600">
                <strong>SO Number:</strong> {props.soNo}
              </Text>
              {props.customerName && (
                <Text className="m-0 mb-[6px] text-[14px] text-gray-600">
                  <strong>Customer:</strong> {props.customerName}
                </Text>
              )}
              {props.grandTotal && (
                <Text className="m-0 text-[14px] text-gray-600">
                  <strong>Grand Total:</strong> {props.grandTotal}
                </Text>
              )}
            </Section>

            <Section className="mb-[32px] text-center">
              <Button
                className="box-border inline-block rounded-[6px] px-[24px] py-[12px] font-medium text-[16px] text-white no-underline"
                href={props.link}
                style={{ backgroundColor: cfg.color }}
              >
                View Sales Order
              </Button>
            </Section>

            <Section className="border-gray-200 border-t pt-[24px]">
              <Text className="m-0 text-center text-[12px] text-gray-500">
                You can also copy this link:{" "}
                <Link className="text-blue-600 underline break-all" href={props.link}>
                  {props.link}
                </Link>
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default SoNotificationEmail;
