// "use client";

// import React, { useEffect, useState } from "react";
// import * as z from "zod";
// import {
//   Card,
//   CardAction,
//   CardContent,
//   CardDescription,
//   CardFooter,
//   CardHeader,
//   CardTitle,
// } from "../ui/card";
// import { Controller, useForm } from "react-hook-form";
// import { Field, FieldError, FieldLabel } from "../ui/field";
// import { Input } from "../ui/input";
// import { zodResolver } from "@hookform/resolvers/zod";
// import { Button } from "../ui/button";
// import { Spinner } from "../ui/spinner";
// import { authClient, useSession } from "@/lib/auth-client";
// import { session } from "@/db/schema";
// import { createRole } from "@/server/roles";
// import { toast } from "sonner";

// type Session = Awaited<ReturnType<typeof authClient.getSession>>["data"];

// const formSchema = z.object({
//   name: z.string().min(3, "Role name is required"),
// });

// const CreateNewRoleForm = () => {
//   // const { data: activeOrganization } = authClient.useActiveOrganization();
//   const { data } = authClient.useSession();
//   console.log(data);
//   const form = useForm<z.infer<typeof formSchema>>({
//     resolver: zodResolver(formSchema),
//     defaultValues: {
//       name: "",
//     },
//   });

//   const onSubmit = async (values: z.infer<typeof formSchema>) => {
//     const { success, message } = await createRole(
//       values.name,
//       data?.session.activeOrganizationId!,
//     );

//     if (success) {
//       toast.success(message);
//     } else {
//       toast.error(message);
//     }
//   };

//   return (
//     <div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min">
//       <Card>
//         <CardHeader>
//           <CardTitle>Create New Role</CardTitle>
//           <CardDescription>
//             Please Provide Name of Your Organization Role
//           </CardDescription>
//           <CardAction>Card Action</CardAction>
//         </CardHeader>
//         <CardContent>
//           <form onSubmit={form.handleSubmit(onSubmit)}>
//             <Controller
//               name="name"
//               control={form.control}
//               render={({ field, fieldState }) => (
//                 <Field data-invalid={fieldState.invalid}>
//                   <FieldLabel htmlFor="name">Role Name</FieldLabel>
//                   <Input
//                     id="name"
//                     type="name"
//                     placeholder="staff"
//                     required
//                     {...field}
//                   />
//                   {fieldState.invalid && (
//                     <FieldError errors={[fieldState.error]} />
//                   )}
//                 </Field>
//               )}
//             />

//             <Field>
//               <Button type="submit" disabled={form.formState.isSubmitting}>
//                 {form.formState.isSubmitting ? (
//                   <>
//                     <Spinner className="size-6" />
//                     Processing
//                   </>
//                 ) : (
//                   "Create New Role"
//                 )}
//               </Button>
//             </Field>
//           </form>
//         </CardContent>
//         <CardFooter>
//           <p>Card Footer</p>
//         </CardFooter>
//       </Card>
//     </div>
//   );
// };

// export default CreateNewRoleForm;
