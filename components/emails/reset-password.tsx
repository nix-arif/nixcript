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

interface ResetPasswordEmailProps {
  email: string;
  resetLink: string;
}

const ResetPasswordEmail = ({ email, resetLink }: ResetPasswordEmailProps) => {
  return (
    <Html dir="ltr" lang="en">
      <Tailwind>
        <Head />
        <Preview>Reset your password</Preview>
        <Body className="bg-gray-100 py-[40px] font-sans">
          <Container className="mx-auto max-w-[600px] rounded-[8px] bg-white p-[40px] shadow-sm">
            <Section className="mb-[32px] text-center">
              <Heading className="m-0 mb-[8px] font-bold text-[28px] text-gray-900">
                Reset your password
              </Heading>
              <Text className="m-0 text-[16px] text-gray-600">
                We received a request to reset your password
              </Text>
            </Section>

            <Section className="mb-[32px]">
              <Text className="m-0 mb-[16px] text-[16px] text-gray-700">
                Hi there,
              </Text>
              <Text className="m-0 mb-[24px] text-[16px] text-gray-700">
                Click the button below to reset your password. This link will
                expire in <strong>1 hour</strong>.
              </Text>
            </Section>

            <Section className="mb-[32px] text-center">
              <Button
                className="box-border inline-block rounded-[6px] bg-blue-600 px-[24px] py-[12px] font-medium text-[16px] text-white no-underline"
                href={resetLink}
              >
                Reset Password
              </Button>
            </Section>

            <Section className="mb-[32px]">
              <Text className="m-0 mb-[8px] text-[14px] text-gray-600">
                If the button above doesn&apos;t work, copy and paste this link
                into your browser:
              </Text>
              <Text className="m-0 break-all text-[14px]">
                <Link className="text-blue-600 underline" href={resetLink}>
                  {resetLink}
                </Link>
              </Text>
            </Section>

            <Section className="border-gray-200 border-t pt-[24px]">
              <Text className="m-0 text-center text-[12px] text-gray-500">
                This email was sent to {email}. If you didn&apos;t request a
                password reset, you can safely ignore this email — your password
                will not be changed.
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default ResetPasswordEmail;
