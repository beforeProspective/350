/* ===== 车辆:低模像素车 + 街机物理(漂移/车重/燃油/耐久) ===== */
'use strict';

class Car {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    // --- 低模车身 ---
    this.bodyMat = new THREE.MeshLambertMaterial({ color: 0xd23c3c, map: Tex.carSide });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1a1e2a });
    const glass = new THREE.MeshLambertMaterial({ color: 0x9adfff, emissive: 0x223344 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.55, 4.2), this.bodyMat);
    body.position.y = 0.55;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 2.1), glass);
    cabin.position.set(0, 1.05, -0.2);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 1.0), dark);
    hood.position.set(0, 0.86, 1.4);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.5), dark);
    spoiler.position.set(0, 1.05, -1.95);
    const spoilerL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, 0.4), dark);
    spoilerL.position.set(-0.85, 0.88, -1.95);
    const spoilerR = spoilerL.clone(); spoilerR.position.x = 0.85;
    // 车灯
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    for (const sx of [-0.7, 0.7]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), lightMat);
      hl.position.set(sx, 0.6, 2.11);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), tailMat);
      tl.position.set(sx, 0.65, -2.11);
      this.group.add(hl, tl);
    }
    this.group.add(body, cabin, hood, spoiler, spoilerL, spoilerR);

    // 车轮
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 8);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x16181d });
    for (const [wx, wz] of [[-1.0, 1.35], [1.0, 1.35], [-1.0, -1.35], [1.0, -1.35]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.42, wz);
      this.group.add(w);
      this.wheels.push(w);
    }
    // 假阴影
    const shadowTex = toTex(pxCanvas(16, 16, (g) => {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.beginPath(); g.ellipse(8, 8, 7, 5, 0, 0, 7); g.fill();
    }), false);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.2),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.06;
    this.group.add(this.shadow);

    this.reset(0, 0, 0);
  }

  setPaint(colorHex) { this.bodyMat.color.setHex(colorHex); }

  // 依据升级计算性能参数
  applyUpgrades(up) {
    const cargoW = (this.cargo || 0) * 60;
    this.weight = 1000 + up.eng * 35 + up.tank * 25 + up.arm * 55 + up.tir * 8 + cargoW;
    const wf = 1000 / this.weight; // 车重因子
    this.topSpeed = 45 * (1 + up.eng * 0.09) * (0.85 + 0.15 * wf);
    this.accel = 18 * (1 + up.eng * 0.09) * wf;
    this.grip = 7 * (1 + up.tir * 0.09);
    this.fuelCap = 100 + up.tank * 22;
    this.durabilityMax = 100 + up.arm * 25;
    this.weight = Math.round(this.weight);
  }

  reset(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.vf = 0; this.vl = 0;
    this.fuel = this.fuelCap || 100;
    this.durability = this.durabilityMax || 100;
    this.cargo = 0;
    this.drifting = false;
    this.offroad = false;
    this.segIdx = 0;
    this.dist = 0;
    this.group.position.set(x, 0, z);
    this.group.rotation.set(0, heading, 0);
    this.group.visible = true;
  }

  get speed() { return Math.sqrt(this.vf * this.vf + this.vl * this.vl); }

  // input: {steer, throttle, brake, drift}; env: {offroad}
  update(dt, input, offroad) {
    const hasFuel = this.fuel > 0;
    const throttle = hasFuel ? input.throttle : 0;
    const wf = 1000 / this.weight;

    // --- 纵向 ---
    const drag = 0.4 * this.vf + (offroad ? 1.3 * this.vf : 0);
    let a = throttle * this.accel - input.brake * (this.vf > 0.5 ? 30 : 0) - drag;
    if (input.brake > 0 && this.vf <= 0.5 && hasFuel) a = -input.brake * 9; // 倒车
    this.vf += a * dt;
    const revMax = 12;
    if (this.vf > this.topSpeed) this.vf = this.topSpeed;
    if (this.vf < -revMax) this.vf = -revMax;
    if (!throttle && !input.brake && Math.abs(this.vf) < 0.4) this.vf = 0;

    // --- 漂移 ---
    this.drifting = input.drift && Math.abs(this.vf) > 8;
    const grip = this.grip * (this.drifting ? 0.22 : 1) * (offroad ? 0.7 : 1);
    this.vl *= Math.exp(-grip * dt);
    if (this.drifting) this.vl += input.steer * Math.abs(this.vf) * 0.85 * dt;

    // --- 转向 ---
    const spdF = Math.min(Math.abs(this.vf) / 8, 1);
    const hiF = 1 - Math.min(Math.abs(this.vf) / this.topSpeed, 1) * 0.45;
    const steerRate = 2.6 * spdF * hiF * (this.drifting ? 1.45 : 1);
    this.heading += input.steer * steerRate * dt * (this.vf >= 0 ? 1 : -1);

    // --- 位移 ---
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const sx = Math.cos(this.heading), sz = -Math.sin(this.heading);
    const vx = fx * this.vf + sx * this.vl;
    const vz = fz * this.vf + sz * this.vl;
    this.x += vx * dt;
    this.z += vz * dt;
    this.dist += Math.sqrt(vx * vx + vz * vz) * dt;

    // --- 油耗(车重越重越耗油,越野额外耗) ---
    this.fuel = Math.max(0, this.fuel - (0.45 + 1.05 * throttle) * (this.weight / 1000) * (offroad ? 1.25 : 1) * dt);

    // --- 视觉 ---
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
    // 车身姿态:漂移侧倾 + 加速俯仰
    const lean = -input.steer * Math.min(Math.abs(this.vf) / this.topSpeed, 1) * 0.1 - this.vl * 0.012;
    const pitch = -throttle * 0.03 + (input.brake ? 0.04 : 0);
    this.group.rotation.z += (lean - this.group.rotation.z) * Math.min(1, 10 * dt);
    this.group.rotation.x += (pitch - this.group.rotation.x) * Math.min(1, 10 * dt);
    // 轮子
    const wSpin = this.vf * dt * 2.4;
    for (let i = 0; i < 4; i++) {
      this.wheels[i].rotation.x += wSpin;
      if (i < 2) this.wheels[i].rotation.y = input.steer * 0.4;
    }
    this.offroad = offroad;
  }

  damage(amount) {
    this.durability = Math.max(0, this.durability - amount);
    return this.durability <= 0;
  }
  refuel(dt) {
    const before = this.fuel;
    this.fuel = Math.min(this.fuelCap, this.fuel + 13 * dt);
    this.durability = Math.min(this.durabilityMax, this.durability + 3 * dt); // 站内顺带小修
    return this.fuel - before;
  }
}
