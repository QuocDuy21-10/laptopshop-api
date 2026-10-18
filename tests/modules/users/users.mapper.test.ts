import { toUserDto } from "modules/users/users.mapper";

const row = {
  id: 1,
  username: "a@b.co",
  fullName: "A",
  address: null,
  phone: null,
  accountType: "SYSTEM",
  avatar: "x.png",
  role: { id: 2, name: "USER" },
};

describe("toUserDto", () => {
  it("never exposes the password, even if the row carries one", () => {
    const dto = toUserDto({ ...row, password: "hash" } as any);
    expect(dto).not.toHaveProperty("password");
  });

  it("maps the avatar to a public path and the role to its name", () => {
    expect(toUserDto(row)).toMatchObject({ avatar: "/images/x.png", role: "USER" });
    expect(toUserDto({ ...row, avatar: null }).avatar).toBeNull();
  });
});
